import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  untracked,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import * as THREE from 'three';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { type MeshSelection } from '../../models/exercise.model';
import { I18n } from '../../i18n/i18n';
import { ExerciseService } from '../../services/exercise.service';
import { buildPlaceholderBody } from './placeholder-body';
import { MOBILE_BREAKPOINT, panelLayout, sheetFrame } from '../../layout/panel-layout';
import { meshLabel } from '../../shared/exercise-format';

// Raycasting through a bounding volume hierarchy instead of testing every triangle: hover picking
// and the view-direction checks go from tens/hundreds of ms to well under 1 ms.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

type LoadState = 'loading' | 'loaded' | 'placeholder';

/** Selected muscles glow orange on the body (the UI accent is turquoise). */
const HIGHLIGHT = new THREE.Color(0xff5a1f);
/** How much lighter a hovered muscle gets (HSL lightness) and how strongly it glows in its own colour. */
const HOVER_LIGHTEN = 0.08;
const HOVER_GLOW = 0.18;
/** Pointer travel (px) above which a press counts as an orbit drag, not a click. */
const CLICK_TOLERANCE = 5;
/** Camera flight to a selected muscle group. */
const FLIGHT_MS = 900;
/** How much room to leave around the selected group (1 = edge to edge). */
const FOCUS_MARGIN = 1.4;
/** Closest zoom on a selected group, as a share of the full-body camera distance. */
const FOCUS_MIN_DISTANCE = 0.28;
/** Left and right halves further apart than this (m) are framed one side at a time. */
const SIDE_GAP = 0.08;

interface CameraPose {
  target: THREE.Vector3;
  position: THREE.Vector3;
}

interface Flight {
  start: number;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  from: THREE.Spherical;
  to: THREE.Spherical;
  /** Shortest way round the body for the horizontal angle. */
  thetaDelta: number;
}

/** Colours of a material before any highlighting. */
interface OriginalLook {
  color: THREE.Color;
  emissive: THREE.Color;
}

@Component({
  selector: 'app-muscle-viewer',
  templateUrl: './muscle-viewer.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Positioned by the parent (absolute inset-0); overlays inside are absolutely positioned.
  host: { class: 'block h-full w-full' },
})
export class MuscleViewer {
  /** Path to the anatomy model inside /public. */
  readonly modelUrl = input('models/male-anatomy.glb');

  /** When true, the body slides aside to make room for the exercise panel. */
  readonly panelOpen = input(false);

  /** Fires with the clicked mesh's name. */
  readonly muscleSelected = output<MeshSelection>();

  protected readonly loadState = signal<LoadState>('loading');
  protected readonly t = inject(I18n).t;
  protected readonly loadProgress = signal(0);
  protected readonly hoverLabel = signal<{
    title: string;
    detail: string;
    x: number;
    y: number;
  } | null>(null);

  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly exercises = inject(ExerciseService);
  private readonly destroyRef = inject(DestroyRef);

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private readonly raycaster = Object.assign(new THREE.Raycaster(), { firstHitOnly: true });
  private readonly pointer = new THREE.Vector2();
  private readonly pickables: THREE.Mesh[] = [];
  private readonly originals = new Map<THREE.MeshStandardMaterial, OriginalLook>();
  private model: THREE.Object3D | null = null;
  private hovered: THREE.Mesh | null = null;
  /**
   * Key that links all meshes of one muscle: its id, or its name without side. Rebuilt when the
   * muscle catalog arrives from the API.
   */
  private linkKeys = new WeakMap<THREE.Object3D, { group: string; family: string | null }>();
  private readonly viewOffset = new THREE.Vector2();
  /** Full-body view, set when the model is framed; the camera returns here when nothing is selected. */
  private home: CameraPose | null = null;
  private flight: Flight | null = null;
  private lastFocusKey: string | null = null;
  private readonly worldBoxes = new WeakMap<THREE.Mesh, THREE.Box3>();
  /** Best view direction per set of muscle groups (see bestViewDirection). */
  private readonly viewDirections = new Map<string, THREE.Vector3>();
  private pointerDownAt: { x: number; y: number } | null = null;
  private frameId = 0;
  private ready = false;

  constructor() {
    afterNextRender(() => {
      this.init();
    });

    // Re-apply highlight whenever the selection changes (from a click or the sidebar).
    effect(() => {
      this.exercises.highlight();
      this.exercises.unknownMeshName();
      if (this.loadState() !== 'loading') this.applyHighlight();
    });

    // The muscle catalog comes from the API, before or after the model: link keys and the
    // precomputed view directions depend on it, so they are rebuilt once both are there.
    effect(() => {
      this.exercises.muscles();
      const ready = this.loadState() === 'loaded' && this.exercises.loadState() === 'ready';
      untracked(() => {
        this.linkKeys = new WeakMap();
        this.viewDirections.clear();
        if (ready) this.precomputeViewDirections();
      });
    });

    // Turn and zoom to the selected group; fly back to the full body when the selection is cleared.
    // Switching between parts of an open family keeps the same focus key, so the camera stays put.
    effect(() => {
      const focus = this.exercises.focus();
      if (this.loadState() === 'loading') return;
      const key = focus?.key ?? null;
      if (key === this.lastFocusKey) return;
      this.lastFocusKey = key;
      if (focus) this.flyToGroups(focus.groupIds, focus.meshName);
      else this.flyHome();
    });
  }

  // ---------- Setup ----------

  private init(): void {
    const canvas = this.canvasRef().nativeElement;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    // Phones have 2–3× pixel density; 1.5 still looks sharp and needs about half the GPU work.
    const maxPixelRatio = window.innerWidth < MOBILE_BREAKPOINT ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();

    // Neutral studio lighting: a soft room environment map plus key / fill / rim lights.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environmentIntensity = 0.45;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x171512, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2.5, 4, 3);
    const fill = new THREE.DirectionalLight(0xdfe6ff, 0.7);
    fill.position.set(-3, 2, 2);
    const rim = new THREE.DirectionalLight(0xffffff, 1.4);
    rim.position.set(0, 3, -4);
    this.scene.add(key, fill, rim);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    this.camera.position.set(0, 1.2, 4);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    // The user takes over: stop any camera flight in progress.
    this.controls.addEventListener('start', () => (this.flight = null));

    this.observeResize();
    this.bindPointerEvents(canvas);
    this.loadModel();
    this.ready = true;
    this.animate();

    this.destroyRef.onDestroy(() => {
      this.dispose();
    });
  }

  private loadModel(): void {
    // The anatomy model is Draco-compressed; the decoder lives in public/draco/.
    const draco = new DRACOLoader().setDecoderPath('draco/');
    const loader = new GLTFLoader().setDRACOLoader(draco);
    loader.load(
      this.modelUrl(),
      (gltf) => {
        draco.dispose();
        this.addModel(gltf.scene);
        this.loadState.set('loaded');
      },
      (e) => {
        if (e.total) this.loadProgress.set(Math.round((e.loaded / e.total) * 100));
      },
      (err) => {
        draco.dispose();
        console.warn(`[MuscleViewer] Could not load "${this.modelUrl()}", using placeholder.`, err);
        this.addModel(buildPlaceholderBody());
        this.loadState.set('placeholder');
      },
    );
  }

  private addModel(model: THREE.Object3D): void {
    model.traverse((obj) => {
      if (!isMesh(obj)) return;
      const mesh = obj;
      // Clone materials so highlighting one muscle never tints others sharing a material.
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((m) => this.cloneMaterial(m))
        : this.cloneMaterial(mesh.material);
      mesh.geometry.computeBoundsTree();
      this.pickables.push(mesh);
    });
    this.model = model;
    this.scene.add(model);
    this.frameModel(model);
  }

  private cloneMaterial(material: THREE.Material): THREE.Material {
    const clone = material.clone();
    if (clone instanceof THREE.MeshStandardMaterial) {
      this.originals.set(clone, { color: clone.color.clone(), emissive: clone.emissive.clone() });
    }
    return clone;
  }

  /** Centre the model and move the camera so the whole body fits in view. */
  private frameModel(model: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = (Math.max(size.y, size.x / this.camera.aspect) / 2 / Math.tan(fov / 2)) * 1.25;

    this.home = {
      target: center.clone(),
      position: new THREE.Vector3(center.x, center.y + size.y * 0.05, center.z + distance),
    };
    this.controls.target.copy(this.home.target);
    this.camera.position.copy(this.home.position);
    this.camera.near = distance / 100;
    this.camera.far = distance * 100;
    this.camera.updateProjectionMatrix();
    // Low enough to zoom right into a small muscle like the brachialis.
    this.controls.minDistance = distance * 0.1;
    this.controls.maxDistance = distance * 2.5;
    this.controls.update();
  }

  // ---------- Camera flights ----------

  private flyHome(): void {
    if (this.home) this.flyTo(this.home.target, this.home.position);
  }

  /**
   * Turns the camera to where the group is best visible and zooms so it fills the space next to
   * the panel. Groups that sit far apart on both sides (shoulders, arms, legs) are shown on one
   * side only, so they can be framed large — e.g. the shoulder from the side.
   */
  private flyToGroups(groupIds: string[], meshName: string | null): void {
    const unknownKey = meshName !== null ? `mesh:${this.exercises.sideless(meshName)}` : null;
    const all = this.pickables.filter((m) => {
      const key = this.keysFor(m).group;
      return groupIds.includes(key) || key === unknownKey;
    });
    if (!all.length) return;

    const { meshes, side } = this.focusSide(all, this.camera.position.x - this.controls.target.x);
    const box = new THREE.Box3();
    for (const mesh of meshes) box.union(this.worldBox(mesh));

    // Look from the side where most of the group is visible, slightly from above.
    const dir = this.cachedViewDirection(groupIds, meshes, side);
    dir.y = 0.15;
    dir.normalize();

    // The free area the group has to fit into (px), and the camera zoom used there:
    // next to the panel on desktop, between header and bottom sheet (scaled down) on phones.
    const { clientWidth: w, clientHeight: h } = this.host.nativeElement;
    const layout = panelLayout(w);
    let freeWidth = w;
    let freeHeight = h;
    let zoom = 1;
    if (layout.mode === 'side') {
      freeWidth = Math.max(120, layout.freeRight - layout.freeLeft);
    } else {
      const frame = sheetFrame(h);
      freeHeight = frame.freeBottom - frame.freeTop;
      zoom = frame.zoom;
    }

    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const extent = {
      right: [Infinity, -Infinity],
      up: [Infinity, -Infinity],
      depth: [Infinity, -Infinity],
    };
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      );
      for (const [axis, v] of [
        ['right', right],
        ['up', up],
        ['depth', dir],
      ] as const) {
        const d = corner.dot(v);
        extent[axis][0] = Math.min(extent[axis][0], d);
        extent[axis][1] = Math.max(extent[axis][1], d);
      }
    }
    const width = extent.right[1] - extent.right[0];
    const height = extent.up[1] - extent.up[0];
    const depth = extent.depth[1] - extent.depth[0];
    // At distance d the screen (h px tall) shows 2·d·tan(fov/2)/zoom of world height; the group,
    // plus margin, has to fit into freeHeight × freeWidth of those pixels.
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2);
    const scale = (zoom * h) / (2 * tan);
    // Never closer than FOCUS_MIN_DISTANCE of the full-body view, so small muscles keep some
    // surrounding body for orientation (e.g. head and arm around the shoulder).
    const minDistance = this.home
      ? this.home.position.distanceTo(this.home.target) * FOCUS_MIN_DISTANCE
      : 0;
    const distance = Math.max(
      this.controls.minDistance,
      minDistance,
      Math.max((height * scale) / freeHeight, (width * scale) / freeWidth) * FOCUS_MARGIN +
        depth / 2,
    );

    const target = box.getCenter(new THREE.Vector3());
    this.flyTo(target, target.clone().addScaledVector(dir, distance));
  }

  /**
   * Splits a group into its left and right meshes. If both halves are clearly apart (more than
   * SIDE_GAP between them), only one half is returned: the one on the side the camera is on
   * (`cameraX` = camera x relative to its target), or the +x side when looking straight on.
   * Groups across the middle of the body (chest, abs, back) are returned whole.
   */
  private focusSide(
    meshes: THREE.Mesh[],
    cameraX: number,
  ): { meshes: THREE.Mesh[]; side: 'both' | 'left' | 'right' } {
    const left = meshes.filter((m) => partName(m).endsWith('_left'));
    const right = meshes.filter((m) => partName(m).endsWith('_right'));
    if (!left.length || !right.length || left.length + right.length !== meshes.length) {
      return { meshes, side: 'both' };
    }

    const boxOf = (ms: THREE.Mesh[]) =>
      ms.reduce((b, m) => b.union(this.worldBox(m)), new THREE.Box3());
    const l = boxOf(left);
    const r = boxOf(right);
    const gap = Math.max(l.min.x - r.max.x, r.min.x - l.max.x);
    if (gap < SIDE_GAP) return { meshes, side: 'both' };

    const leftIsPositive = l.getCenter(new THREE.Vector3()).x > 0;
    const wantPositive = Math.abs(cameraX) < 0.05 ? true : cameraX > 0;
    return leftIsPositive === wantPositive
      ? { meshes: left, side: 'left' }
      : { meshes: right, side: 'right' };
  }

  /**
   * Front, back, left or right — whichever shows most of the given meshes. Samples points on the
   * meshes and casts a ray at each from outside the body; a point counts if nothing covers it.
   * For groups on both sides, front/back are preferred, since a side view only shows one side.
   */
  private bestViewDirection(meshes: THREE.Mesh[], singleSide: boolean): THREE.Vector3 {
    const sideWeight = singleSide ? 1 : 0.6;
    // Compare meshes, not group ids: the left deltoid must not count as "visible right deltoid".
    const own = new Set<THREE.Object3D>(meshes);
    const groupBox = new THREE.Box3();
    for (const m of meshes) groupBox.union(this.worldBox(m));
    const samples: THREE.Vector3[] = [];
    const perMesh = Math.max(2, Math.ceil(24 / meshes.length));
    for (const mesh of meshes) {
      const pos = mesh.geometry.getAttribute('position');
      const step = Math.max(1, Math.floor(pos.count / perMesh));
      for (let i = 0; i < pos.count; i += step) {
        samples.push(
          new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld),
        );
      }
    }

    const candidates = [
      { dir: new THREE.Vector3(0, 0, 1), weight: 1 }, // front
      { dir: new THREE.Vector3(0, 0, -1), weight: 1 }, // back
      { dir: new THREE.Vector3(1, 0, 0), weight: sideWeight }, // +x side
      { dir: new THREE.Vector3(-1, 0, 0), weight: sideWeight }, // -x side
    ];
    const ray = new THREE.Raycaster();
    ray.firstHitOnly = true; // only the closest hit matters (BVH shortcut)
    let best = candidates[0];
    let bestScore = -1;
    for (const c of candidates) {
      // Only meshes in the corridor between the group and the viewer can block it (keeps this fast).
      const corridor = groupBox
        .clone()
        .expandByVector(
          new THREE.Vector3(Math.abs(c.dir.x), 0, Math.abs(c.dir.z)).multiplyScalar(3),
        );
      const blockers = this.pickables.filter((m) => corridor.intersectsBox(this.worldBox(m)));
      let visible = 0;
      for (const p of samples) {
        ray.set(p.clone().addScaledVector(c.dir, 3), c.dir.clone().negate());
        ray.far = 3.01;
        const hit = ray.intersectObjects(blockers, false).at(0);
        if (hit && own.has(hit.object)) visible++;
      }
      const score = visible * c.weight;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best.dir.clone();
  }

  private cachedViewDirection(
    groupIds: string[],
    meshes: THREE.Mesh[],
    side: 'both' | 'left' | 'right',
  ): THREE.Vector3 {
    const ids = [...groupIds].sort().join('|') || `mesh:${meshes.map((m) => m.name).join('|')}`;
    const key = `${ids}#${side}`;
    let dir = this.viewDirections.get(key);
    if (!dir) {
      dir = this.bestViewDirection(meshes, side !== 'both');
      this.viewDirections.set(key, dir);
    }
    return dir.clone();
  }

  /**
   * Works out the view direction for every family and single muscle while the browser is idle,
   * one at a time, so a later click can start the camera flight without any delay.
   */
  private precomputeViewDirections(): void {
    const sets = [
      ...this.exercises.families().map((f) => f.muscleIds),
      ...this.exercises
        .muscles()
        .filter((m) => !m.familyId)
        .map((m) => [m.id]),
      // Opening an exercise frames all muscles it trains.
      ...this.exercises.allExercises().map((e) => [...e.primaryMuscles, ...e.secondaryMuscles]),
    ];
    const idle: (cb: () => void) => void =
      'requestIdleCallback' in window
        ? (cb) => requestIdleCallback(cb, { timeout: 2000 })
        : (cb) => setTimeout(cb, 50);
    const next = () => {
      const ids = sets.shift();
      if (!ids || !this.ready) return;
      const meshes = this.pickables.filter((m) => ids.includes(this.keysFor(m).group));
      if (meshes.length) {
        // Either side may be the one in focus later, depending on where the camera is.
        for (const cameraX of [1, -1]) {
          const focus = this.focusSide(meshes, cameraX);
          this.cachedViewDirection(ids, focus.meshes, focus.side);
          if (focus.side === 'both') break;
        }
      }
      idle(next);
    };
    idle(next);
  }

  /** World-space bounding box per mesh, cached (the model never moves). */
  private worldBox(mesh: THREE.Mesh): THREE.Box3 {
    let box = this.worldBoxes.get(mesh);
    if (!box) {
      box = new THREE.Box3().setFromObject(mesh);
      this.worldBoxes.set(mesh, box);
    }
    return box;
  }

  private flyTo(target: THREE.Vector3, position: THREE.Vector3): void {
    const from = new THREE.Spherical().setFromVector3(
      this.camera.position.clone().sub(this.controls.target),
    );
    const to = new THREE.Spherical().setFromVector3(position.clone().sub(target));
    let thetaDelta = to.theta - from.theta;
    if (thetaDelta > Math.PI) thetaDelta -= 2 * Math.PI;
    if (thetaDelta < -Math.PI) thetaDelta += 2 * Math.PI;
    this.flight = {
      start: performance.now(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
      from,
      to,
      thetaDelta,
    };
  }

  /** Moves the camera along an arc around the body (never through it). */
  private stepFlight(): void {
    const f = this.flight;
    if (!f) return;
    const t = Math.min(1, (performance.now() - f.start) / FLIGHT_MS);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // ease in-out
    this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
    const s = new THREE.Spherical(
      THREE.MathUtils.lerp(f.from.radius, f.to.radius, e),
      THREE.MathUtils.lerp(f.from.phi, f.to.phi, e),
      f.from.theta + f.thetaDelta * e,
    );
    this.camera.position.setFromSpherical(s).add(this.controls.target);
    if (t >= 1) this.flight = null;
  }

  // ---------- Interaction ----------

  private bindPointerEvents(canvas: HTMLCanvasElement): void {
    const onDown = (e: PointerEvent) => (this.pointerDownAt = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      const start = this.pointerDownAt;
      this.pointerDownAt = null;
      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_TOLERANCE) return;
      const hit = this.pick(e);
      if (hit) this.muscleSelected.emit({ meshName: partName(hit) });
    };
    const onMove = (e: PointerEvent) => {
      if (this.pointerDownAt) return; // dragging the camera
      this.setHovered(this.pick(e), e);
    };
    const onLeave = () => {
      this.setHovered(null);
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    this.destroyRef.onDestroy(() => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    });
  }

  /**
   * Raycast from the pointer and return the front-most mesh, if it is a muscle. Nothing is
   * pickable until the muscle catalog has arrived from the API.
   */
  private pick(e: PointerEvent): THREE.Mesh | null {
    if (this.exercises.loadState() !== 'ready') return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const mesh = this.raycaster.intersectObjects(this.pickables, false).at(0)?.object;
    // Skin, bone and other non-muscle meshes block the ray but aren't selectable.
    return mesh && isMesh(mesh) && this.isMuscle(mesh) ? mesh : null;
  }

  private isMuscle(mesh: THREE.Mesh): boolean {
    if (this.loadState() === 'placeholder') return !mesh.name.startsWith('Skin_');
    // The export script tags parts via glTF "extras" (-> userData). Untagged meshes count as muscles.
    const kind: unknown = partOf(mesh).userData['kind'];
    return kind === undefined || kind === 'muscle';
  }

  private setHovered(mesh: THREE.Mesh | null, e?: PointerEvent): void {
    if (mesh && e) {
      const rect = this.host.nativeElement.getBoundingClientRect();
      const name = partName(mesh);
      const group = this.exercises.groupFor(name);
      // Hover shows what a click would select: the whole family, or the single part once its
      // family is open.
      const insideOpenFamily =
        !!group?.familyId && group.familyId === this.exercises.selectedFamilyId();
      const target = insideOpenFamily ? group : (this.exercises.familyFor(group) ?? group);
      this.hoverLabel.set({
        title: target?.name ?? meshLabel(name),
        detail: target && target.latinName !== target.name ? target.latinName : '',
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    } else if (!mesh) {
      this.hoverLabel.set(null);
    }
    if (mesh === this.hovered) return;
    this.hovered = mesh;
    this.renderer.domElement.style.cursor = mesh ? 'pointer' : 'grab';
    this.applyHighlight();
  }

  // ---------- Highlighting ----------

  /**
   * Keys that link meshes: `group` is the muscle group id (both sides of one muscle), `family`
   * the family id if the group has one. Meshes outside any group are linked with their mirror
   * image via the name without side.
   */
  private keysFor(mesh: THREE.Object3D): { group: string; family: string | null } {
    const part = partOf(mesh);
    let keys = this.linkKeys.get(part);
    if (!keys) {
      const group = this.exercises.groupFor(part.name);
      keys = {
        group: group?.id ?? `mesh:${this.exercises.sideless(part.name)}`,
        family: group?.familyId ?? null,
      };
      this.linkKeys.set(part, keys);
    }
    return keys;
  }

  /** Hover lights up what a click would select: the family, or a single part inside the open family. */
  private hoverKey(keys: { group: string; family: string | null }): string {
    if (!keys.family || keys.family === this.exercises.selectedFamilyId()) return keys.group;
    return `family:${keys.family}`;
  }

  /**
   * Tints the selection on both sides of the body: strong for the selected muscle / part,
   * soft for the other parts of its family. Hover gives the whole family a glow.
   */
  private applyHighlight(): void {
    const { strong, soft } = this.exercises.highlight();
    const unknown = this.exercises.unknownMeshName();
    const unknownKey = unknown !== null ? `mesh:${this.exercises.sideless(unknown)}` : null;
    const hoveredKey = this.hovered ? this.hoverKey(this.keysFor(this.hovered)) : null;

    for (const mesh of this.pickables) {
      const keys = this.keysFor(mesh);
      const level =
        strong.has(keys.group) || keys.group === unknownKey
          ? 'strong'
          : soft.has(keys.group)
            ? 'soft'
            : null;
      const hovered = hoveredKey !== null && this.hoverKey(keys) === hoveredKey;

      for (const mat of asArray(mesh.material)) {
        if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
        const original = this.originals.get(mat);
        if (!original) continue;
        mat.color.copy(original.color);
        // Focus: bright orange. Working along: clearly orange too, but darker.
        if (level === 'strong') mat.color.lerp(HIGHLIGHT, 0.85);
        else if (level === 'soft') mat.color.lerp(HIGHLIGHT, 0.7);
        // Raise lightness only, so red stays red instead of washing out to pink.
        if (hovered) mat.color.offsetHSL(0, 0, HOVER_LIGHTEN);

        mat.emissive.copy(original.emissive);
        // The glow is what makes the focus brighter than the muscles working along.
        if (level === 'strong') mat.emissive.copy(HIGHLIGHT).multiplyScalar(hovered ? 0.55 : 0.42);
        else if (level === 'soft') {
          mat.emissive.copy(HIGHLIGHT).multiplyScalar(hovered ? 0.12 : 0.02);
        }
        // Hover: let the muscle glow in its own colour so it clearly lights up.
        else if (hovered) mat.emissive.copy(mat.color).multiplyScalar(HOVER_GLOW);
      }
    }
  }

  // ---------- Render loop & lifecycle ----------

  private animate = (): void => {
    this.frameId = requestAnimationFrame(this.animate);
    // While the exercise card animates, hold everything (the last frame stays visible) and keep a
    // pending camera flight at its start, so it begins right after the card animation.
    if (this.exercises.cardAnimating()) {
      if (this.flight) this.flight.start = performance.now();
      return;
    }
    this.stepFlight();
    this.controls.update();
    this.updateViewOffset();
    this.renderer.render(this.scene, this.camera);
  };

  /**
   * Slides the rendered image so the body sits in the free space next to the panel.
   * Uses the camera's view offset, so orbiting and raycasting keep working unchanged.
   */
  private updateViewOffset(): void {
    const { clientWidth: w, clientHeight: h } = this.host.nativeElement;
    if (!w || !h) return;
    let tx = 0;
    let ty = 0;
    let zoom = 1;
    if (this.panelOpen()) {
      const layout = panelLayout(w);
      if (layout.mode === 'side') {
        // Positive offset moves the image left; the body lands at layout.bodyCenterX.
        tx = w / 2 - layout.bodyCenterX;
      } else {
        // Bottom sheet: shrink the picture so it fits between the header and the sheet, centred there.
        const frame = sheetFrame(h);
        ty = h / 2 - (frame.freeTop + frame.freeBottom) / 2;
        zoom = frame.zoom;
      }
    }

    // Ease towards the target each frame.
    const target = new THREE.Vector2(tx, ty);
    if (this.viewOffset.distanceTo(target) < 0.5) this.viewOffset.copy(target);
    else this.viewOffset.lerp(target, 0.12);
    const zoomDone = Math.abs(this.camera.zoom - zoom) < 0.002;
    if (!zoomDone || this.camera.zoom !== zoom) {
      this.camera.zoom = zoomDone ? zoom : THREE.MathUtils.lerp(this.camera.zoom, zoom, 0.12);
      this.camera.updateProjectionMatrix();
    }

    if (this.viewOffset.lengthSq() === 0) {
      if (this.camera.view?.enabled) this.camera.clearViewOffset();
      return;
    }
    this.camera.setViewOffset(w, h, this.viewOffset.x, this.viewOffset.y, w, h);
  }

  private observeResize(): void {
    const el = this.host.nativeElement;
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    this.destroyRef.onDestroy(() => {
      observer.disconnect();
    });
  }

  private dispose(): void {
    if (!this.ready) return;
    cancelAnimationFrame(this.frameId);
    this.controls.dispose();
    this.scene.traverse((obj) => {
      if (!isMesh(obj)) return;
      const mesh = obj;
      mesh.geometry.disposeBoundsTree();
      mesh.geometry.dispose();
      asArray(mesh.material).forEach((m) => {
        m.dispose();
      });
    });
    this.scene.environment?.dispose();
    this.renderer.dispose();
  }
}

function isMesh(obj: THREE.Object3D): obj is THREE.Mesh {
  return obj instanceof THREE.Mesh;
}

function asArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

/**
 * A muscle with several materials (muscle belly + tendon) loads as a Group of meshes.
 * The object carrying the glTF extras ("kind") is the logical part; otherwise the mesh itself.
 */
function partOf(mesh: THREE.Object3D): THREE.Object3D {
  if (mesh.userData['kind']) return mesh;
  if (mesh.parent?.userData['kind']) return mesh.parent;
  return mesh;
}

function partName(mesh: THREE.Object3D): string {
  return partOf(mesh).name;
}

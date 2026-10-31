import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fxlib } from './pixelfx';
import type { DenMeta, FxAnchor, FxSurface, LoadedFx } from './types';

/** Paths of the effects toolkit (Node only). */
export const FX_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = join(FX_ROOT, '..', '..');
export const EFFECTS_DIR = join(FX_ROOT, 'effects');
export const VENDOR_DIR = join(FX_ROOT, 'vendor', 'pixelfx');
export const CATALOG_FILE = join(FX_ROOT, 'src', 'catalog.gen.ts');
/** Renders to look at (gitignored, never committed). */
export const RECORDS_DIR = join(REPO_ROOT, 'records', 'fx');
/** Baked strips, served by the web app. */
export const STRIPS_DIR = join(REPO_ROOT, 'apps', 'web', 'public', 'assets', 'sprites', 'fx');
export const STRIPS_URL = '/assets/sprites/fx';
/** The vendored upstream commit; `pnpm fx:library` clones the full library at this commit. */
export const PIXELFX_COMMIT = 'fe7103c36d94e02f2d7df7d8f7a341e493837cde';
export const LIBRARY_DIR = join(REPO_ROOT, 'records', '.pixelfx', PIXELFX_COMMIT);
export const LIBRARY_FX_DIR = join(LIBRARY_DIR, 'src', 'fx');

/** Every effect id (`group/name`), sorted. Files and folders starting with `_` are helpers. */
export function effectIds(): string[] {
  return fxlib.allIds(EFFECTS_DIR);
}

/** Ids matching patterns: an id, a group (`spell`), a glob (`spell/fire*`) or a file path. */
export function resolveEffectIds(patterns: string[]): string[] {
  return fxlib.resolveIds(patterns, EFFECTS_DIR);
}

/** Imports an effect fresh (the CLI re-imports after every edit). */
export function loadEffect(id: string): Promise<LoadedFx> {
  return fxlib.loadEffect(id, EFFECTS_DIR);
}

/** A pixelfx library effect from the clone made by `pnpm fx:library`. */
export function loadLibraryEffect(id: string): Promise<LoadedFx> {
  return fxlib.loadEffect(id, LIBRARY_FX_DIR);
}

const SURFACE_OF_GROUP: Record<string, FxSurface> = {
  spell: 'town',
  aura: 'town',
  town: 'town',
  pet: 'pet',
  ui: 'ui',
};

export interface ResolvedDen {
  surface: FxSurface;
  depth: 'under' | 'over';
  anchor: FxAnchor;
  stand: 'avatar' | 'pet' | 'companion' | 'none';
  scale: number;
  variants: Record<string, Record<string, unknown>>;
  from: string | null;
}

/** `meta.den` with its defaults (the group folder decides the surface when the effect doesn't say). */
export function denOf(fx: LoadedFx): ResolvedDen {
  const den: Partial<DenMeta> = fx.meta.den ?? {};
  const group = fx.id.split('/')[0] ?? '';
  const surface = den.surface ?? SURFACE_OF_GROUP[group] ?? 'ui';
  return {
    surface,
    depth: den.depth ?? 'over',
    anchor: den.anchor ?? (surface === 'town' ? 'feet' : 'free'),
    stand: den.stand ?? (surface === 'town' ? 'avatar' : surface === 'pet' ? 'companion' : 'none'),
    scale: den.scale ?? (surface === 'pet' ? 4 : 2),
    variants: den.variants ?? {},
    from: den.from ?? null,
  };
}

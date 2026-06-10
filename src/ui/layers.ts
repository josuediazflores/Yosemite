import type { LayerId } from '../model';
import { state, toggleLayer } from '../state';

const LAYER_DEFS: { id: LayerId; label: string; swatch: string }[] = [
  { id: 'sites', label: 'Sites', swatch: 'swatch--site' },
  { id: 'sightings', label: 'Sightings', swatch: 'swatch--sighting' },
  { id: 'fire', label: 'Fire', swatch: 'swatch--fire' },
  { id: 'hazards', label: 'Quakes', swatch: 'swatch--quake' },
];

export function initLayerControl(container: HTMLElement): void {
  container.innerHTML = `
    <legend>Layers</legend>
    ${LAYER_DEFS.map(
      (l) => `
      <label class="layer-toggle">
        <input type="checkbox" data-layer="${l.id}" ${state.layers[l.id] ? 'checked' : ''} />
        <span class="layer-toggle__pip ${l.swatch}" aria-hidden="true"></span>
        <span>${l.label}</span>
      </label>`,
    ).join('')}`;

  container.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const layer = input.dataset.layer as LayerId | undefined;
    if (layer) toggleLayer(layer, input.checked);
  });
}

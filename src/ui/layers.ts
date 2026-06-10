import type { LayerId } from '../model';
import { state, toggleLayer } from '../state';

// Each row carries its generated landmark badge (design-system icon set,
// assets/icons/*-badge.png) in place of the old CSS pips.
const LAYER_DEFS: { id: LayerId; label: string; icon: string }[] = [
  { id: 'sites', label: 'Sites', icon: '/icons/viewpoint-badge.png' },
  { id: 'camps', label: 'Camps', icon: '/icons/camp-badge.png' },
  { id: 'sightings', label: 'Sightings', icon: '/icons/sighting-badge.png' },
  { id: 'heat', label: 'Heatmap', icon: '/icons/heatmap-badge.png' },
  { id: 'fire', label: 'Fire', icon: '/icons/fire-badge.png' },
  { id: 'hazards', label: 'Quakes', icon: '/icons/quake-badge.png' },
];

export function initLayerControl(container: HTMLElement): void {
  container.innerHTML = `
    <legend>Layers</legend>
    ${LAYER_DEFS.map(
      (l) => `
      <label class="layer-toggle">
        <input type="checkbox" data-layer="${l.id}" ${state.layers[l.id] ? 'checked' : ''} />
        <img class="layer-toggle__badge" src="${l.icon}" alt="" aria-hidden="true" />
        <span>${l.label}</span>
      </label>`,
    ).join('')}`;

  container.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement;
    const layer = input.dataset.layer as LayerId | undefined;
    if (layer) toggleLayer(layer, input.checked);
  });
}

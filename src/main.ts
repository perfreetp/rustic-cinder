import { mount } from 'svelte';
import App from './App.svelte';
import {
  appState,
  addMass,
  clearMasses,
  compute,
  endInteraction,
  loadPreset,
  removeMass,
  scheduleInteractiveCompute,
  setDirection,
  updateMass
} from './lib/appState.svelte';
import './app.css';

const app = mount(App, {
  target: document.getElementById('app')!
});

// Expose the reactive singleton plus its action functions for debugging and
// automated tests. This is the exact module graph the components bind to, so
// external mutations stay in the same reactivity graph.
declare global {
  interface Window {
    __app: typeof appState & {
      addMass: typeof addMass;
      removeMass: typeof removeMass;
      updateMass: typeof updateMass;
      clearMasses: typeof clearMasses;
      loadPreset: typeof loadPreset;
      setDirection: typeof setDirection;
      compute: typeof compute;
      scheduleInteractiveCompute: typeof scheduleInteractiveCompute;
      endInteraction: typeof endInteraction;
    };
  }
}

window.__app = Object.assign(appState, {
  addMass,
  removeMass,
  updateMass,
  clearMasses,
  loadPreset,
  setDirection,
  compute,
  scheduleInteractiveCompute,
  endInteraction
});

export default app;

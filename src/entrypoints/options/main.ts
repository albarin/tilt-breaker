import { mount } from 'svelte';
import App from './App.svelte';
import '../../ui/app.css';
// The confirmation's primary button, shared with the popup and the overlay.
import '../../ui/button.css';

export default mount(App, {
  target: document.getElementById('app')!,
});

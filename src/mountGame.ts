import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

export function mountGame() {
  createApp(App).mount('#app')
}

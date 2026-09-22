import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './prysmal-prism.css'

const roots = new Map()
let cleanupObserver = null

function parseJSON(value, fallback = null) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch (error) {
    console.error('[Prysmal Prism] Invalid JSON:', error, value)
    return fallback
  }
}

function isElementorEditor() {
  try {
    const params = new URLSearchParams(window.location.search)
    return Boolean(
      params.has('elementor-preview') ||
        document.body?.classList.contains('elementor-editor-active') ||
        window.elementorFrontend?.isEditMode?.()
    )
  } catch {
    return false
  }
}

function ensureCleanupObserver() {
  if (cleanupObserver || !document.documentElement) return
  cleanupObserver = new MutationObserver(() => {
    roots.forEach((root, element) => {
      if (!element.isConnected) {
        root.unmount()
        roots.delete(element)
      }
    })
  })
  cleanupObserver.observe(document.documentElement, { childList: true, subtree: true })
}

function mountPrism(element) {
  if (!element || roots.has(element)) return

  const assetsUrl = (element.dataset.assetsUrl || '').replace(/\/$/, '')
  if (!assetsUrl && assetsUrl !== '') {
    console.error('[Prysmal Prism] Missing data-assets-url on renderer container.')
    return
  }

  const settings = parseJSON(element.dataset.settings, {}) || {}
  const customJSON = parseJSON(element.dataset.customJson, null)
  const sequenceJSON = parseJSON(element.dataset.scrollSequence, null)

  const root = createRoot(element)
  roots.set(element, root)
  ensureCleanupObserver()

  root.render(
    <App
      assetsUrl={assetsUrl}
      settings={settings}
      customJSON={customJSON}
      sequenceJSON={sequenceJSON}
      hostElement={element}
      elementorEditor={isElementorEditor()}
    />
  )
}

function init(scope = document) {
  const root = scope?.querySelectorAll ? scope : document
  root.querySelectorAll('.prysmal-prism').forEach(mountPrism)
}

function initElementor() {
  init()
  if (window.elementorFrontend?.hooks) {
    window.elementorFrontend.hooks.addAction('frontend/element_ready/prysmal_prism_renderer.default', ($scope) => {
      const scope = $scope?.[0] || $scope
      if (!scope) return
      init(scope)
    })
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => init(), { once: true })
} else {
  init()
}

window.addEventListener('elementor/frontend/init', initElementor)

window.PrysmalPrism = { init, mount: mountPrism }

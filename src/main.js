import './scss/app.scss';
// import './scss/app.scss';
import { INCLUDE_FEATURES } from './config';
import { detectAndRun } from './loader';

import pageTransitions from './features/page-transitions/page-transitions';
import navbar from './features/navbar';
import customFeature from './features/custom-feature';
import animations from './features/animations/animations';
import scrollBehaviour from './features/scroll-behaviour/scroll-behaviour';
import breakpoints from './features/breakpoints';
import glossary from './features/glossary';
import textScramble from './features/text-scramble';
import textStagger from './features/text-stagger';
import marquee from './features/marquee';
import vimeoBackground from './features/videos/vimeo-background';
import vimeoAdvanced from './features/videos/vimeo-advanced';
import parallax from './features/parallax';
import microInteractions from './features/micro-interactions';
import faq from './features/faq';
import utilities from './features/utilities';


// ============================================
// START
// ============================================
detectAndRun(runApp);

// ============================================
// BUNDLED APP
// ============================================
function runApp() {
  const ACTIVE_FEATURES = getFeaturesFromScriptTag();

  function initFeatures() {
    ACTIVE_FEATURES.pageTransitions && pageTransitions();
    ACTIVE_FEATURES.navbar && navbar();
    ACTIVE_FEATURES.customFeature && customFeature();
    ACTIVE_FEATURES.animations && animations();
    ACTIVE_FEATURES.scrollBehaviour && scrollBehaviour();
    ACTIVE_FEATURES.breakpoints && breakpoints();
    ACTIVE_FEATURES.glossary && glossary();
    ACTIVE_FEATURES.textScramble && textScramble();
    ACTIVE_FEATURES.textStagger && textStagger();
    ACTIVE_FEATURES.marquee && marquee();
    ACTIVE_FEATURES.vimeoBackground && vimeoBackground();
    ACTIVE_FEATURES.vimeoAdvanced && vimeoAdvanced();
    ACTIVE_FEATURES.parallax && parallax();
    ACTIVE_FEATURES.microInteractions && microInteractions();
    ACTIVE_FEATURES.faq && faq();
    ACTIVE_FEATURES.utilities && utilities();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFeatures);
  } else {
    initFeatures();
  }
}

// ============================================
// FEATURE DETECTION FROM SCRIPT TAG ATTRIBUTES
// ============================================
// Usage: <script src="main.min.js" breakpoints glossary></script>
// If no attributes: falls back to config.js
function getFeaturesFromScriptTag() {
  const scripts = Array.from(document.querySelectorAll('script[src*="main"]'));
  let currentScript = null;

  try {
    currentScript = scripts.find(script => {
      if (!script.src) return false;
      return script.src.includes('main.js') || script.src.includes('main.min.js');
    });
  } catch {
    currentScript = null;
  }

  if (!currentScript) {
    return INCLUDE_FEATURES;
  }

  const features = {};
  Object.keys(INCLUDE_FEATURES).forEach(key => {
    features[key] = currentScript.hasAttribute(key);
  });

  const hasAnyAttribute = Object.values(features).some(v => v === true);
  if (!hasAnyAttribute) {
    return INCLUDE_FEATURES;
  }

  return features;
}

let currentView = null;
let navigationVersion = 0;
const container = document.getElementById('app');

const routes = {};

function register(name, render) {
  routes[name] = render;
}

function navigate(name, params = {}) {
  if (routes[name]) {
    currentView = name;
    const version = ++navigationVersion;
    routes[name](container, params, {
      isCurrent: () => currentView === name && navigationVersion === version,
    });
    window.scrollTo(0, 0);
  }
}

export { register, navigate, container };

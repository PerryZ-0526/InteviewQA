let currentView = null;
const container = document.getElementById('app');

const routes = {};

function register(name, render) {
  routes[name] = render;
}

function navigate(name, params = {}) {
  if (routes[name]) {
    currentView = name;
    routes[name](container, params);
    window.scrollTo(0, 0);
  }
}

export { register, navigate, container };

// Tailwind config for OmniDeck's controller UI. output.html never uses
// Tailwind classes (it's the on-air stage — styled entirely by
// render-engine.js/stage.css), so only controller.html + its JS need
// scanning. JS is included because controller.js builds several class
// strings dynamically at runtime (e.g. the toast() helper's color classes,
// the align/valign button active state) — content plain-text scanning is
// how Tailwind's JIT finds those without them ever appearing in the HTML.
module.exports = {
  content: ['./frontend/controller.html', './frontend/js/*.js'],
  theme: {
    extend: {}
  },
  plugins: []
};

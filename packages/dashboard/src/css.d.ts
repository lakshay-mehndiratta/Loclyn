// Lets TypeScript accept `import "./globals.css"`. Next.js handles the CSS itself at
// build time; TypeScript 6 (newer than the pinned 5.5.4) otherwise reports error 2882
// ("Cannot find module or type declarations for side-effect import") in the editor.
declare module "*.css";
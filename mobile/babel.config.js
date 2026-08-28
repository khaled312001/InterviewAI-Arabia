module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          /*
           * Rewrite `import.meta` to `globalThis.__ExpoImportMetaRegistry`.
           *
           * Metro emits the web bundle as a CLASSIC script — `<script src>`
           * with no `type="module"` — and `import.meta` is a SyntaxError
           * outside a module. Not a runtime error: the engine refuses to
           * parse, so a single occurrence anywhere in 3MB of bundle takes the
           * whole app down before a line of it runs.
           *
           * It arrives from a dependency, not from us. `zustand/middleware`
           * guards its devtools with `import.meta.env.MODE`, a Vite-ism; SDK
           * 53+ turned on `package.json` "exports" resolution by default, so
           * Metro started picking zustand's ESM build (`esm/middleware.mjs`)
           * where the CommonJS one it used to resolve had no such syntax.
           *
           * Expo's own transform is off by default for client bundles, and on
           * web it does not even warn — it throws for Hermes and silently
           * passes the syntax through for web, which is precisely how an
           * unparseable bundle shipped. Turning it on is the supported fix;
           * the matching runtime object is installed by `expo/src/winter`.
           */
          unstable_transformImportMeta: true,
        },
      ],
    ],
    plugins: ['react-native-reanimated/plugin'],
  };
};

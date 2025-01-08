// See the Tailwind configuration guide for advanced usage
// https://tailwindcss.com/docs/configuration

const plugin = require("tailwindcss/plugin");
const fs = require("fs");
const path = require("path");

module.exports = {
  content: ["./js/**/*.js", "../lib/dojo_web.ex", "../lib/dojo_web/**/*.*ex"],
  theme: {
    extend: {
      colors: {
        brand: "#FF9933",
        ink: "#1E1024",
      },
      dropShadow: {
        glow: [
          "0 0px 20px rgba(255,255, 255, 0.35)",
          "0 0px 65px rgba(255, 255,255, 0.2)"
        ]},
      transitionDuration: {
        '3000': '3000ms',
        '5000': '5000ms',
        '10000': '10000ms',
      },
      animation: {
        halfmarquee: 'halfmarquee 30s linear infinite',
        marquee: 'fullmarquee 30s linear infinite',
        gradient: 'gradient-anim 30s ease infinite',
        flicker: 'flicker 3s linear infinite',
        fade: 'fadeIn 1s ease-in-out',
        fadeout: 'fadeOut 5s forwards',
        glitchy: 'glitchy 5s ease-in-out infinite',
        wiggle: 'wiggle 5s ease-in-out infinite',
        colourise: 'colourise 2s ease-in-out forwards',
        typewriter: 'typewriter 2s steps(11) forwards',
        spinslow: 'spin 12s linear infinite',
        caret: 'typewriter 2s steps(11) forwards, blink 1s steps(11) infinite 2s',
      },
      keyframes: {
        typewriter: {
          to: {
            left: '100%',
          },
        },
        blink: {
          '0%': {
            opacity: '0',
          },
          '0.1%': {
            opacity: '1',
          },
          '50%': {
            opacity: '1',
          },
          '50.1%': {
            opacity: '0',
          },
          '100%': {
            opacity: '0',
          },
        },
        colourise: {
          from: { filter: 'grayscale(1)' },
          to: {filter: 'grayscale(0)' },
        },
        fadeIn: {
					from: { opacity: 0 },
					to: { opacity: 1 },
				},
        fadeOut: {
					from: { opacity: 1 },
					to: { opacity: 0 },
				},
        wiggle: {
          '0%': { transform: 'rotate(0deg)' },
          '50%': { transform: 'rotate(10deg)' },
          '100%': { transform: 'rotate(0deg)' }
        },
        halfmarquee: {
          '0%': {transform: 'translateY(42vh)'},
          '100%': {transform: 'translateY(-100%)'}
        },
        fullmarquee: {
          '0%': {transform: 'translateY(66vh)'},
          '100%': {transform: 'translateY(-100%)'}
        },
        'gradient-anim': {
          '0%': { backgroundPosition: '0% 0%' },
          '10%': { backgroundPosition: '20% 0%' },
          '20%': { backgroundPosition: '40% 0%' },
          '30%': { backgroundPosition: '20% 30%' },
          '36%': { backgroundPosition: '0% 0%' },
          '72%': { backgroundPosition: '36% 36%' },
          '80%': { backgroundPosition: '45% 45%' },
          '88%': { backgroundPosition: '20% 20%' },
          '100%': { backgroundPosition: '0% 0%' },
        },
        glitchy: {
          '0%':  { transform: 'translate(0)'},
          '20%': { transform: 'translate(-2px, 2px)'},
          '40%': { transform: 'translate(-2px, -2px)'},
          '60%': { transform: 'translate(2px, 2px)'},
          '80%': { transform: 'translate(2px, -2px)'},
          '100%': { transform: 'translate(0)'}
        },
        flicker: {
          "0%, 19.9%, 22%, 62.9%, 64%, 64.9%, 70%, 100%": {
            opacity: 0.99,
            textShadow:
            "-1px -1px 0 rgba(255, 255, 255, 0.6), " +
              "1px -1px 0 rgba(255, 255, 255, 0.6), " +
              "-1px 1px 0 rgba(255, 255, 255, 0.6), " +
              "1px 1px 0 rgba(255, 255, 255, 0.6), " +
              "0 -2px 8px rgba(255, 255, 255, 0.8), " +
              "0 0 2px rgba(255, 255, 255, 0.8), " +
              "0 0 5px rgba(255, 255, 255, 0.9), " +
              "0 0 15px rgba(200, 200, 255, 0.7), " +
              "0 0 20px rgba(200, 200, 255, 0.5), " +
              "0 2px 3px #00664f"
          },
          "20%, 21.9%, 63%, 63.9%, 65%, 69.9%": {
            opacity: 0.4,
            textShadow: "none"
          }
        }
      },
      
    },
  },
  plugins: [
    require("@tailwindcss/forms"),
    // Allows prefixing tailwind classes with LiveView classes to add rules
    // only when LiveView classes are applied, for example:
    //
    //     <div class="phx-click-loading:animate-ping">
    //
    plugin(({ addVariant }) =>
      addVariant("phx-no-feedback", [".phx-no-feedback&", ".phx-no-feedback &"])
    ),
    plugin(({ addVariant }) =>
      addVariant("phx-click-loading", [
        ".phx-click-loading&",
        ".phx-click-loading &",
      ])
    ),
    plugin(({ addVariant }) =>
      addVariant("phx-submit-loading", [
        ".phx-submit-loading&",
        ".phx-submit-loading &",
      ])
    ),
    plugin(({ addVariant }) =>
      addVariant("phx-change-loading", [
        ".phx-change-loading&",
        ".phx-change-loading &",
      ])
    ),

    // Embeds Heroicons (https://heroicons.com) into your app.css bundle
    // See your `CoreComponents.icon/1` for more information.
    //
    plugin(function ({ matchComponents, theme }) {
      let iconsDir = path.join(__dirname, "../deps/heroicons/optimized");
      let values = {};
      let icons = [
        ["", "/24/outline"],
        ["-solid", "/24/solid"],
        ["-mini", "/20/solid"],
        ["-micro", "/16/solid"],
      ];
      icons.forEach(([suffix, dir]) => {
        fs.readdirSync(path.join(iconsDir, dir)).forEach((file) => {
          let name = path.basename(file, ".svg") + suffix;
          values[name] = { name, fullPath: path.join(iconsDir, dir, file) };
        });
      });
      matchComponents(
        {
          hero: ({ name, fullPath }) => {
            let content = fs
              .readFileSync(fullPath)
              .toString()
              .replace(/\r?\n|\r/g, "");
            let size = theme("spacing.6");
            if (name.endsWith("-mini")) {
              size = theme("spacing.5");
            } else if (name.endsWith("-micro")) {
              size = theme("spacing.4");
            }
            return {
              [`--hero-${name}`]: `url('data:image/svg+xml;utf8,${content}')`,
              "-webkit-mask": `var(--hero-${name})`,
              mask: `var(--hero-${name})`,
              "mask-repeat": "no-repeat",
              "background-color": "currentColor",
              "vertical-align": "middle",
              display: "inline-block",
              width: size,
              height: size,
            };
          },
        },
        { values }
      );
    }),
  ],
};

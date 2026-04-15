defmodule Dojo.MixProject do
  use Mix.Project

  def project do
    [
      app: :dojo,
      version: "0.3.2",
      elixir: "~> 1.18",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() in [:prod, :local],
      aliases: aliases(),
      deps: deps(),
      listeners: [Phoenix.CodeReloader],
      compilers: [:phoenix_live_view] ++ Mix.compilers(),
      releases: releases(),
      usage_rules: usage_rules()
    ]
  end

  # Configuration for the OTP application.
  #
  # Type `mix help compile.app` for more information.
  def application do
    [
      mod: {Dojo.Application, []},
      extra_applications: [:logger, :runtime_tools, :inets]
    ]
  end

  # Specifies which paths to compile per environment.
  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  # Specifies your project dependencies.
  #
  # Type `mix help deps` for examples and options.
  defp deps do
    [
      {:tidewave, "~> 0.5", only: [:dev]},
      {:igniter, "~> 0.6", only: [:dev, :test]},
      {:usage_rules, "~> 1.1", only: :dev},
      {:lazy_html, ">= 0.0.0", only: :test},
      {:phoenix, "~> 1.8"},
      {:phoenix_ecto, "~> 4.4"},
      {:ecto_sql, "~> 3.10"},
      {:postgrex, ">= 0.0.0"},
      {:phoenix_html, "~> 4.0"},
      {:phoenix_live_reload, "~> 1.5", only: :dev},
      {:phoenix_live_view, "~> 1.1.3"},
      {:phoenix_pubsub, "~> 2.2"},
      {:floki, ">= 0.30.0", only: :test},
      {:phoenix_live_dashboard, "~> 0.8.6"},
      {:esbuild, "~> 0.9", runtime: Mix.env() == :dev},
      {:tailwind, "~> 0.3", runtime: Mix.env() == :dev},
      {:heroicons,
       github: "tailwindlabs/heroicons",
       tag: "v2.1.1",
       sparse: "optimized",
       app: false,
       compile: false,
       depth: 1},
      {:swoosh, "~> 1.5"},
      {:finch, "~> 0.13"},
      {:telemetry, "~> 1.4"},
      {:telemetry_metrics, "~> 1.0"},
      {:telemetry_poller, "~> 1.0"},
      {:gettext, "~> 0.26"},
      {:jason, "~> 1.2"},
      {:kino, "~> 0.16"},
      {:nebulex, "~> 2.6"},
      {:shards, "~> 1.1.1"},
      {:observer_cli, "~> 1.8"},
      {:kino_vega_lite, "~> 0.1.11"},
      {:dns_cluster, "~> 0.2"},
      {:bandit, "~> 1.2"},
      {:earmark, "1.5.0-pre1", override: true},
      {:earmark_parser, "1.4.44"},
      {:html_sanitize_ex, "~> 1.4"},
      {:makeup, "~> 1.1"},
      {:makeup_elixir, "~> 0.16"},
      {:burrito, "~> 1.5"},
      {:partisan, partisan_dep()},
      # Protocol Buffers for safe, non-atom signaling
      {:recon, "~> 2.5"},
      {:protox, "~> 2.0"}
      # {:libcluster, "~> 3.3.0"}
    ]
  end

  defp usage_rules do
    [
      file: "CLAUDE.md",
      usage_rules: ["usage_rules:all"],
      skills: [
        location: ".claude/skills",
        build: [
          "phoenix-framework": [
            description:
              "Use this skill when working with Phoenix Framework — controllers, LiveViews, routing, PubSub, Presence, and the web layer.",
            usage_rules: [:phoenix, ~r/^phoenix_/]
          ]
        ]
      ]
    ]
  end

  defp partisan_dep() do
    if path = System.get_env("PARTISAN_PATH") do
      [path: path]
    else
      [github: "paperlands/partisan", commit: "c5309d4"]
    end
  end

  # Aliases are shortcuts or tasks specific to the current project.
  # For example, to install project dependencies and perform other setup tasks, run:
  #
  #     $ mix setup
  #
  # See the documentation for `Mix` for more info on aliases.

  defp aliases do
    [
      setup: ["deps.get", "compile", "assets.setup", "assets.build", "assets.deploy"],
      "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],
      "ecto.reset": ["ecto.drop", "ecto.setup"],
      test: ["test"],
      "assets.setup": ["tailwind.install --if-missing", "esbuild.install --if-missing"],
      "assets.build": ["tailwind dojo", "esbuild dojo"],
      "assets.deploy": [
        "tailwind dojo --minify",
        "esbuild dojo --minify",
        "phx.digest"
      ]
    ]
  end

  def releases do
    steps =
    if Mix.env() == :local do
      [:assemble, &Burrito.wrap/1, &post_wrap/1]
    else
      [:assemble]
    end

    [
      dojo: [
        steps: steps,
        burrito: [
          targets: [
            macos: [os: :darwin, cpu: :x86_64],
            macos_silicon: [os: :darwin, cpu: :aarch64],
            linux: [os: :linux, cpu: :x86_64],
            windows: [os: :windows, cpu: :x86_64]
          ]
        ]
      ]
    ]
  end
  defp post_wrap(%Mix.Release{} = release) do
    strip_linux(release)
    build_windows_installer(release)
    build_macos_app_bundle(release)
    build_macos_dmg(release)
    release
  end

  defp strip_linux(%Mix.Release{name: name}) do
    binary = "burrito_out/#{name}_linux"

    if File.exists?(binary) do
      IO.puts("==> Stripping Linux binary: #{binary}")

      case System.cmd("strip", ["--strip-all", binary], stderr_to_stdout: true) do
        {_, 0} -> IO.puts("    Strip successful")
        {output, code} -> Mix.raise("strip failed (exit #{code}): #{output}")
      end
    else
      IO.puts("==> Skipping strip — #{binary} not found (not on Linux host?)")
    end
  end

  defp build_windows_installer(%Mix.Release{}) do
    nsi = "burrito_out/installer.nsi"

    if File.exists?(nsi) do
      IO.puts("==> Building Windows installer with NSIS")

      case System.cmd("makensis", [nsi], stderr_to_stdout: true) do
        {_, 0} -> IO.puts("    NSIS build successful")
        {output, code} -> Mix.raise("makensis failed (exit #{code}): #{output}")
      end
    else
      IO.puts("==> Skipping NSIS — #{nsi} not found")
    end
  end

  defp build_macos_app_bundle(%Mix.Release{name: name, version: version}) do
  Enum.each([:macos, :macos_silicon], fn target ->
    binary_name = "#{name}_#{target}"
    binary_src = "burrito_out/#{binary_name}"

    if File.exists?(binary_src) do
      IO.puts("==> Creating macOS .app bundle for #{target}")

      bundle_path = "burrito_out/PaperLandDojo_#{target}.app"
      contents    = "#{bundle_path}/Contents"
      macos_dir   = "#{contents}/MacOS"
      resources_dir = "#{contents}/Resources"

      File.mkdir_p!(macos_dir)
      File.mkdir_p!(resources_dir)

      dest_binary = "#{macos_dir}/dojo"
      File.copy!(binary_src, dest_binary)
      File.chmod!(dest_binary, 0o755)

      File.write!("#{contents}/Info.plist", info_plist(version))
      File.write!("#{contents}/PkgInfo", "APPL????")

      icns_src = "burrito_out/resources/app-icon.icns"
      if File.exists?(icns_src) do
        File.copy!(icns_src, "#{resources_dir}/app-icon.icns")
        IO.puts("    Copied #{icns_src} into bundle")
      else
        IO.puts("    No .icns found at #{icns_src} — skipping icon (convert burrito_out/resources/app-icon.ico first)")
      end

      IO.puts("    Bundle created at #{bundle_path}")
    else
      IO.puts("==> Skipping .app bundle for #{target} — #{binary_src} not found")
    end
  end)
  end

  defp build_macos_dmg(%Mix.Release{name: _name, version: version}) do
    Enum.each([{"macos", "x86_64"}, {"macos_silicon", "arm64"}], fn {target, arch} ->
      app_name = "PaperLandDojo_#{target}.app"
      app_path = "burrito_out/#{app_name}"
      dmg_out  = "burrito_out/PaperLandDojo_#{arch}.dmg"

      if File.exists?(app_path) do                      # ← mirrors your bundle guard
        IO.puts("==> Building macOS DMG for #{target} (#{arch})")
        build_dmg(app_path, app_name, dmg_out, version)
      else
        IO.puts("==> Skipping DMG for #{target} — #{app_path} not found")
      end
    end)
  end

  defp build_dmg(app_path, app_name, dmg_out, _version) do
    tmp_dir = System.tmp_dir!()
    |> Path.join("dmgstage_#{:erlang.unique_integer([:positive])}")
    File.mkdir_p!(tmp_dir)

    try do
      run!("cp", ["-r", app_path, Path.join(tmp_dir, app_name)], "staging .app")
      File.ln_s!("/Applications", Path.join(tmp_dir, "Applications"))


      run!("sh", ["-c", """
      genisoimage \
      -V "PaperLand Dojo" -D -R -apple -no-pad \
      -o #{dmg_out} #{tmp_dir}
      """], "genisoimage → #{dmg_out}")


      IO.puts("    DMG created at #{dmg_out}")
    after
      File.rm_rf(tmp_dir)
    end
  end

  defp run!(cmd, args, label) do
    IO.puts("    [#{label}] #{cmd} #{Enum.join(args, " ")}")

    case System.cmd(cmd, args, stderr_to_stdout: true) do
      {_, 0}           -> :ok
      {output, code}   -> Mix.raise("#{label} failed (exit #{code}):\n#{output}")
    end
  end

  defp info_plist(version) do
    """
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
    "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
    <key>CFBundleName</key>
    <string>PaperLand Dojo</string>

    <key>CFBundleDisplayName</key>
    <string>PaperLand Dojo</string>

    <key>CFBundleIdentifier</key>
    <string>com.paperland.dojo</string>

    <key>CFBundleVersion</key>
    <string>#{version}</string>

    <key>CFBundleShortVersionString</key>
    <string>#{version}</string>

    <key>CFBundlePackageType</key>
    <string>APPL</string>

    <key>CFBundleSignature</key>
    <string>????</string>

    <key>CFBundleExecutable</key>
    <string>dojo</string>

    <key>CFBundleIconFile</key>
    <string>app-icon.icns</string>

    <key>LSMinimumSystemVersion</key>
    <string>11.0</string>

    <key>NSHighResolutionCapable</key>
    <true/>

    <key>LSUIElement</key>
    <false/>

    <key>NSPrincipalClass</key>
    <string>NSApplication</string>

    <key>NSHumanReadableCopyright</key>
    <string>© PaperLand</string>
    </dict>
    </plist>
    """
  end
end

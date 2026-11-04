defmodule Dojo.MixProject do
  use Mix.Project

  def project do
    [
      app: :dojo,
      version: "0.6.0",
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
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
      {:usage_rules, "~> 1.1", only: :dev},
      {:lazy_html, ">= 0.0.0", only: :test},
      {:phoenix, "~> 1.8"},
      {:phoenix_ecto, "~> 4.4"},
      {:ecto_sql, "~> 3.10"},
      {:ecto_sqlite3, "~> 0.26.0"},
      {:phoenix_html, "~> 4.0"},
      {:phoenix_live_reload, "~> 1.5", only: :dev},
      {:phoenix_live_view, "~> 1.2.0"},
      {:phoenix_pubsub, "~> 2.2"},
      {:floki, ">= 0.30.0", only: :test},
      {:phoenix_live_dashboard, "~> 0.9.1"},
      {:esbuild, "~> 0.9", runtime: Mix.env() == :dev},
      {:tailwind, "~> 0.5", runtime: Mix.env() == :dev},
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
      {:gettext, "~> 1.0"},
      {:jason, "~> 1.2"},
      {:nebulex, "~> 3.1"},
      {:nebulex_distributed, "~> 3.3"},
      {:shards, "~> 1.1.1"},
      {:observer_cli, "~> 2.0"},
      {:dns_cluster, "~> 0.2"},
      {:bandit, "~> 1.2"},
      {:burrito, burrito_dep()},
      {:partisan, partisan_dep()},
      # The PubSub adapter is its own app on purpose: a host compile unloads
      # every module it recompiles, and the Gate's tracker calls the adapter by
      # atom every 3s. Deps are never purged — see vendor/phx_pubsub_partisan.
      {:phx_pubsub_partisan, path: "vendor/phx_pubsub_partisan"},
      {:recon, "~> 2.5"}
    ]
  end

  defp usage_rules do
    [
      file: "AGENTS.md",
      usage_rules: [],
      skills: [
        location: ".agents/skills",
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
      [path: local_path!("PARTISAN_PATH", path)]
    else
      # Pinned by SHA, not a branch: a branch name in mix.exs is what let the
      # lock drift to the v5 tip while the source assumed v6 (D070). The SHA is
      # the fork's `reorg/v6.3.2-port` tip, sliced into reviewable PRs upstream.
      [github: "paperlands/partisan", ref: "bf16654c0c9bec4aac999e38cd43167ad2ae17d1"]
    end
  end

  # Mix expands a `path:` requirement against the project that declared it, and
  # the vendored adapter declares partisan too: a relative PARTISAN_PATH names
  # two different directories. Absolute, or fail before the lock is touched.
  defp local_path!(var, path) do
    Path.type(path) == :absolute || Mix.raise("#{var} must be absolute, got: #{path}")
    path
  end

  # Like PARTISAN_PATH: point at a local Burrito fork for development
  # (e.g. testing 32-bit Windows wrapper changes) without a push/lock cycle.
  defp burrito_dep() do
    if path = System.get_env("BURRITO_PATH") do
      [path: local_path!("BURRITO_PATH", path)]
    else
      [github: "paperlands/burrito", commit: "latest"]
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
      setup: [
        "deps.get",
        "compile",
        "ecto.create",
        "ecto.migrate",
        "assets.setup",
        "assets.build",
        "assets.deploy"
      ],
      "ecto.setup": ["ecto.create", "ecto.migrate"],
      "ecto.reset": ["ecto.drop", "ecto.setup"],
      test: ["ecto.create --quiet", "ecto.migrate --quiet", "test"],
      "assets.setup": ["tailwind.install --if-missing", "esbuild.install --if-missing"],
      # press.codex: id→{name,title} index for the weave resolver (Shoot 0 / Q2),
      # and the vendor recast into priv/static/codex (what the web reaches).
      "press.codex": &press_codex/1,
      # verify.assets wraps the deploy build (id:assets-bundle-boundary).
      "verify.assets": &verify_assets/1,
      "assets.build": [
        "press.codex",
        "tailwind dojo",
        "esbuild dojo"
      ],
      "assets.deploy": [
        "press.codex",
        "tailwind dojo --minify",
        "verify.assets",
        "phx.digest"
      ]
    ]
  end

  # The press is a projection OF the corpus, so it only runs where the corpus
  # stands. Images ship the committed vendor, never codex/ (see .dockerignore) —
  # no corpus there, nothing to press, and the build must not care.
  defp press_codex(args) do
    if File.dir?("codex/fragments") do
      Mix.Task.run("cmd", ["node", "scripts/codex/press_codex_index.mjs" | args])
    else
      Mix.shell().info("press.codex: no codex/fragments here — skipped")
    end
  end

  # id:assets-bundle-boundary — the contract this enforces, in one line: every
  # synchronous browser dependency is either bundled or refused, never left to
  # become a runtime require. esbuild only reports externals as success, so the
  # artifact and the metafile are the witnesses. Own outdir: this asserts on the
  # thing the browser receives, independent of when phx.digest runs.
  # id:assets-bundle-boundary — the build is the witness, not a pattern match: if
  # a synchronous dependency was externalized the metafile records it as an
  # external import, and the browser gets a __require call it cannot honour.
  # Names nothing, so it cannot go stale when a vendored file is deleted; Linux
  # cannot fail it (it never externalizes), Windows can.
  #
  # Builds to a scratch dir and publishes only verified bytes: a failing build
  # must not leave a broken bundle where the dev server serves it (learned the
  # hard way — the falsification run leaked one into priv/static).
  defp verify_assets(_args) do
    out = Path.join(System.tmp_dir!(), "dojo-verify-assets")
    meta = Path.join(out, "meta.json")
    File.rm_rf!(out)
    File.mkdir_p!(out)

    # The configured --outdir loses to this one (esbuild: last wins).
    Mix.Task.run("esbuild", ["dojo", "--minify", "--outdir=#{out}", "--metafile=#{meta}"])

    outputs = meta |> File.read!() |> Jason.decode!() |> Map.fetch!("outputs")

    externals =
      for {_entry, info} <- outputs,
          import <- info["imports"] || [],
          import["external"] == true,
          uniq: true,
          do: "#{import["path"]} (#{import["kind"]})"

    if externals != [] do
      File.rm_rf!(out)

      Mix.raise("""
      verify.assets: the bundle has external imports, which ship as runtime require():
        #{Enum.join(externals, "\n  ")}
      Bundle the dependency, or make it an approved runtime import (non-analyzable specifier).
      """)
    end

    "app.js"
    |> then(&File.read!(Path.join(out, &1)))
    |> String.contains?("sourceMappingURL=data:")
    |> if(do: Mix.raise("verify.assets: deploy artifact carries an inline sourcemap"))

    for entry <- File.ls!(out), entry != "meta.json" do
      File.cp_r!(Path.join(out, entry), Path.join("priv/static/assets/js", entry))
    end

    File.rm_rf!(out)
  end

  def releases do
    steps =
      if Mix.env() == :local do
        [:assemble, &prune_journals/1, &Burrito.wrap/1, &post_wrap/1]
      else
        [:assemble, &prune_journals/1]
      end

    [
      dojo: [
        steps: steps,
        burrito: [
          targets: burrito_targets()
        ]
      ]
    ]
  end

  # priv/ ships whole, so a keep_dev.db left in the tree would ride into an
  # installer carrying its author's journal. Only the migrations belong here.
  defp prune_journals(%Mix.Release{path: path} = release) do
    [path, "lib", "dojo-*", "priv", "keep", "*.db*"]
    |> Path.join()
    |> Path.wildcard()
    |> Enum.each(fn stray ->
      Mix.shell().info("prune_journals: #{Path.relative_to(stray, path)}")
      File.rm!(stray)
    end)

    release
  end

  # Burrito build targets.
  #
  # The 32-bit Windows target is isolated behind BURRITO_WIN32=1 because
  # Erlang/OTP discontinued 32-bit Windows builds at OTP 29 — there is no
  # otp_win32 ERTS for OTP 29–32. The x86 installer must therefore be built
  # on a host running OTP 28.5.0.2 (the last line with a win32 release), so
  # BOTH the compiled BEAM and the bundled ERTS are OTP 28 (forward-loading
  # OTP-29 bytecode on an OTP-28 VM would fail). CI runs that target in a
  # dedicated OTP-28 job; everything else builds on the current OTP 29.
  defp burrito_targets do
    if System.get_env("BURRITO_WIN32") == "1" do
      [windows_x86: [os: :windows, cpu: :x86]]
    else
      [
        macos: [os: :darwin, cpu: :x86_64],
        macos_silicon: [os: :darwin, cpu: :aarch64],
        linux: [os: :linux, cpu: :x86_64],
        windows: [os: :windows, cpu: :x86_64]
      ]
    end
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

  # Each Windows arch gets its own installer, rendered from the shared EEx
  # template. `:source` is the Burrito-emitted binary (target name keyed),
  # installed under the stable name dojo_windows.exe so the firewall/shortcut
  # logic is arch-agnostic. `:label` is the artifact arch in filenames
  # (matches the x86_64/x86 convention used by release.yml).
  defp windows_installer_variants do
    [
      %{
        label: "x86_64",
        arch: "x64",
        source: "dojo_windows.exe",
        program_files: "$PROGRAMFILES64",
        reg_view: "64",
        vc_redist: "VC_redist.x64.exe",
        vcredist_key: "SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64",
        guard_running_x64: true
      },
      %{
        label: "x86",
        arch: "x86",
        source: "dojo_windows_x86.exe",
        program_files: "$PROGRAMFILES",
        reg_view: "32",
        vc_redist: "VC_redist.x86.exe",
        vcredist_key: "SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x86",
        guard_running_x64: false
      }
    ]
  end

  defp build_windows_installer(%Mix.Release{version: version}) do
    template = "rel/packaging/installer.nsi.eex"

    cond do
      System.find_executable("makensis") == nil ->
        IO.puts("==> Skipping NSIS — makensis not found (Burrito binaries still built)")

      !File.exists?(template) ->
        IO.puts("==> Skipping NSIS — #{template} not found")

      true ->
        build_windows_installers(template, version)
    end
  end

  defp build_windows_installers(template, version) do
    # Stage resources into burrito_out/ where NSIS expects them
    File.mkdir_p!("burrito_out/resources")

    for file <- File.ls!("rel/packaging/resources") do
      File.copy!("rel/packaging/resources/#{file}", "burrito_out/resources/#{file}")
    end

    File.copy!("rel/packaging/resources/app-icon.ico", "burrito_out/app-icon.ico")

    erts_version = :erlang.system_info(:version) |> to_string()
    template_src = File.read!(template)

    Enum.each(windows_installer_variants(), fn variant ->
      build_windows_installer_variant(template_src, version, erts_version, variant)
    end)
  end

  defp build_windows_installer_variant(template_src, version, erts_version, variant) do
    binary = "burrito_out/#{variant.source}"

    if File.exists?(binary) do
      IO.puts("==> Building Windows #{variant.label} installer with NSIS")

      rendered =
        EEx.eval_string(template_src,
          assigns: [
            app_version: version,
            erts_version: erts_version,
            label: variant.label,
            arch: variant.arch,
            source_binary: variant.source,
            program_files: variant.program_files,
            reg_view: variant.reg_view,
            vc_redist: variant.vc_redist,
            vcredist_key: variant.vcredist_key,
            guard_running_x64: variant.guard_running_x64
          ]
        )

      nsi = "burrito_out/installer_#{variant.arch}.nsi"
      File.write!(nsi, rendered)

      IO.puts("    Rendered → #{nsi} (#{variant.label}, v#{version}, ERTS #{erts_version})")

      case System.cmd("makensis", [nsi], stderr_to_stdout: true) do
        {_, 0} ->
          IO.puts("    NSIS #{variant.label} build successful")

        {output, code} ->
          Mix.raise("makensis (#{variant.label}) failed (exit #{code}): #{output}")
      end
    else
      IO.puts("==> Skipping NSIS #{variant.label} — #{binary} not found")
    end
  end

  defp build_macos_app_bundle(%Mix.Release{name: name, version: version}) do
    Enum.each([:macos, :macos_silicon], fn target ->
      binary_name = "#{name}_#{target}"
      binary_src = "burrito_out/#{binary_name}"

      if File.exists?(binary_src) do
        IO.puts("==> Creating macOS .app bundle for #{target}")

        bundle_path = "burrito_out/PaperLandDojo_#{target}.app"
        contents = "#{bundle_path}/Contents"
        macos_dir = "#{contents}/MacOS"
        resources_dir = "#{contents}/Resources"

        File.mkdir_p!(macos_dir)
        File.mkdir_p!(resources_dir)

        dest_binary = "#{macos_dir}/dojo"
        File.copy!(binary_src, dest_binary)
        File.chmod!(dest_binary, 0o755)

        File.write!("#{contents}/Info.plist", info_plist(version))
        File.write!("#{contents}/PkgInfo", "APPL????")

        icns_src = "rel/packaging/resources/app-icon.icns"

        if File.exists?(icns_src) do
          File.copy!(icns_src, "#{resources_dir}/app-icon.icns")
          IO.puts("    Copied #{icns_src} into bundle")
        else
          IO.puts(
            "    No .icns found at #{icns_src} — skipping icon (convert app-icon.ico to .icns)"
          )
        end

        IO.puts("    Bundle created at #{bundle_path}")
      else
        IO.puts("==> Skipping .app bundle for #{target} — #{binary_src} not found")
      end
    end)
  end

  defp build_macos_dmg(%Mix.Release{version: version}) do
    if System.find_executable("genisoimage") == nil do
      IO.puts("==> Skipping macOS DMG — genisoimage not found (.app bundles still built)")
    else
      Enum.each([{"macos", "x86_64"}, {"macos_silicon", "arm64"}], fn {target, arch} ->
        app_name = "PaperLandDojo_#{target}.app"
        app_path = "burrito_out/#{app_name}"
        dmg_out = "burrito_out/PaperLandDojo-#{version}-macos-#{arch}.dmg"

        if File.exists?(app_path) do
          IO.puts("==> Building macOS DMG for #{target} (#{arch})")
          build_dmg(app_path, app_name, dmg_out, version)
        else
          IO.puts("==> Skipping DMG for #{target} — #{app_path} not found")
        end
      end)
    end
  end

  defp build_dmg(app_path, app_name, dmg_out, _version) do
    tmp_dir =
      System.tmp_dir!()
      |> Path.join("dmgstage_#{:erlang.unique_integer([:positive])}")

    File.mkdir_p!(tmp_dir)

    try do
      run!("cp", ["-r", app_path, Path.join(tmp_dir, app_name)], "staging .app")
      File.ln_s!("/Applications", Path.join(tmp_dir, "Applications"))

      run!(
        "sh",
        [
          "-c",
          """
          genisoimage \
          -V "PaperLand Dojo" -D -R -apple -no-pad \
          -o #{dmg_out} #{tmp_dir}
          """
        ],
        "genisoimage → #{dmg_out}"
      )

      IO.puts("    DMG created at #{dmg_out}")
    after
      File.rm_rf(tmp_dir)
    end
  end

  defp run!(cmd, args, label) do
    IO.puts("    [#{label}] #{cmd} #{Enum.join(args, " ")}")

    case System.cmd(cmd, args, stderr_to_stdout: true) do
      {_, 0} -> :ok
      {output, code} -> Mix.raise("#{label} failed (exit #{code}):\n#{output}")
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

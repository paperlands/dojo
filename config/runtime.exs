import Config

# config/runtime.exs is executed for all environments, including
# during releases. It is executed after compilation and before the
# system starts, so it is typically used to load production configuration
# and secrets from environment variables or elsewhere. Do not define
# any compile-time configuration in here, as it won't be applied.
# The block below contains prod specific runtime configuration.

# ## Using releases
#
# If you use `mix release`, you need to explicitly enable the server
# by passing the PHX_SERVER=true when you start it:
#
#     PHX_SERVER=true bin/dojo start
#
# Alternatively, you can use `mix phx.gen.release` to generate a `bin/server`
# script that automatically sets the env var above.
if config_env() == :local do
  config :dojo, DojoWeb.Endpoint, server: true

  secret_key_base = 
    System.get_env("SECRET_KEY_BASE") || :crypto.strong_rand_bytes(64) |> Base.encode64()

  config :dojo, DojoWeb.Endpoint,
    url: [host: "#{:net_adm.localhost}", port: System.get_env("PORT") || 4000],
    http: [ip: {0, 0, 0, 0}, port: System.get_env("PORT") || 4000],
    check_origin: false,
    secret_key_base: secret_key_base

  
else
  if System.get_env("PHX_SERVER") do
    config :dojo, DojoWeb.Endpoint, server: true
  end
end


# --erl "-start_epmd false -kernel dist_auto_connect never"

#config :kernel,
#   # Disable standard dist
#   dist_auto_connect: :never,
#   # Stop EPMD from booting
#   start_epmd: false 
port = 53627-:rand.uniform(100)
System.put_env("PARTISAN_PORT", "#{port}")
partisan_name = "admin@" <> Ecto.UUID.generate()
System.put_env("PARTISAN_NAME", partisan_name)

config :partisan,
  # The Identity. Default is name@host, but we want UUID-based for roaming.
  # We implement a custom callback to return a stable UUID from disk.
  name: String.to_atom(partisan_name),
  authentication: :partisan_auth_hmac,
  # HyParView: The specific topology for high-churn environments
  peer_service_manager: :partisan_hyparview_peer_service_manager,
  pid_encoding: false,
  ref_encoding: false,
  # Fanout: Keep active view small (5 peers) to minimize bandwidth
  hyparview_active_view_size: 3,
  # Passive View: Keep a large backup list (24) for quick healing
  hyparview_passive_view_size: 15,
  listen_addrs: [%{port: port, ip: {127, 0, 0, 1}}],
  # Parallelism: separate control (heartbeats) from data (state)
  channels: %{
    # 'gossip' is a reserved/default channel name usually required for HyParView
    gossip: %{
      parallelism: 1
    },
    undefined: %{
      parallelism: 1
    },
    # Custom data channel
    data: %{
      parallelism: 2,
      # compression: true,
      # monotonic: false, # No HOL blocking
      # distance_enabled: false, # random selection
      # ingress_delay: 0, # no latency
      # exchange_tick_period: 10000 #best effort pubsub
      
    },
    # Custom control channel
    control: %{
      parallelism: 1,
      monotonic: true
    }
  },
  phi_threshold: 12.0,
  secret: System.get_env("DOJO_CLUSTER_SECRET") || "dev_secret",
  # Sample window size
  gossip_interval: 1000, # 1 second heartbeats
   listen_options: [
    {:raw, 1, 15, <<1 :: native-32>>} # SO_REUSEPORT = 15 on Linux/Android usually CHECK IF LINUX ENV
  ]

config :dojo, Phoenix.PubSub.Partisan,
  # Map adapter logic to Partisan channels
  channel_data: :data,
  channel_control: :control

config :mdns_lite,
  # 1. Identity: How we appear to others
  hosts: [:hostname],
  instance_name: Dojo.Clan.gen_name(3),
  # This allows us to query `_dojo_cluster._tcp.local` via Erlang
  dns_bridge_enabled: true,
  dns_bridge_ip: {127, 0, 0, 53},
  dns_bridge_port: 1212
  
if config_env() == :prod do
  # database_url =
  #   System.get_env("DATABASE_URL") ||
  #     raise """
  #     environment variable DATABASE_URL is missing.
  #     For example: ecto://USER:PASS@HOST/DATABASE
  #     """

  # maybe_ipv6 = if System.get_env("ECTO_IPV6") in ~w(true 1), do: [:inet6], else: []

  # config :dojo, Dojo.Repo,
  #   # ssl: true,
  #   url: database_url,
  #   pool_size: String.to_integer(System.get_env("POOL_SIZE") || "10"),
  #   socket_options: maybe_ipv6

  # The secret key base is used to sign/encrypt cookies and other secrets.
  # A default value is used in config/dev.exs and config/test.exs but you
  # want to use a different value for prod and you most likely don't want
  # to check this value into version control, so we use an environment
  # variable instead.
  secret_key_base =
    System.get_env("SECRET_KEY_BASE") ||
      raise """
      environment variable SECRET_KEY_BASE is missing.
      You can generate one by calling: mix phx.gen.secret
      """

  host = System.get_env("PHX_HOST") || "example.com"
  port = String.to_integer(System.get_env("PORT") || "4000")

  config :dojo, :dns_cluster_query, System.get_env("DNS_CLUSTER_QUERY")

  config :dojo, DojoWeb.Endpoint,
    url: [host: host, port: 443, scheme: "https"],
    http: [
      # Enable IPv6 and bind on all interfaces.
      # Set it to  {0, 0, 0, 0, 0, 0, 0, 1} for local network only access.
      # See the documentation on https://hexdocs.pm/bandit/Bandit.html#t:options/0
      # for details about using IPv6 vs IPv4 and loopback vs public addresses.
      ip: {0, 0, 0, 0, 0, 0, 0, 0},
      port: port
    ],
    secret_key_base: secret_key_base

  # ## SSL Support
  #
  # To get SSL working, you will need to add the `https` key
  # to your endpoint configuration:
  #
  #     config :dojo, DojoWeb.Endpoint,
  #       https: [
  #         ...,
  #         port: 443,
  #         cipher_suite: :strong,
  #         keyfile: System.get_env("SOME_APP_SSL_KEY_PATH"),
  #         certfile: System.get_env("SOME_APP_SSL_CERT_PATH")
  #       ]
  #
  # The `cipher_suite` is set to `:strong` to support only the
  # latest and more secure SSL ciphers. This means old browsers
  # and clients may not be supported. You can set it to
  # `:compatible` for wider support.
  #
  # `:keyfile` and `:certfile` expect an absolute path to the key
  # and cert in disk or a relative path inside priv, for example
  # "priv/ssl/server.key". For all supported SSL configuration
  # options, see https://hexdocs.pm/plug/Plug.SSL.html#configure/1
  #
  # We also recommend setting `force_ssl` in your config/prod.exs,
  # ensuring no data is ever sent via http, always redirecting to https:
  #
  #     config :dojo, DojoWeb.Endpoint,
  #       force_ssl: [hsts: true]
  #
  # Check `Plug.SSL` for all available options in `force_ssl`.

  # ## Configuring the mailer
  #
  # In production you need to configure the mailer to use a different adapter.
  # Also, you may need to configure the Swoosh API client of your choice if you
  # are not using SMTP. Here is an example of the configuration:
  #
  #     config :dojo, Dojo.Mailer,
  #       adapter: Swoosh.Adapters.Mailgun,
  #       api_key: System.get_env("MAILGUN_API_KEY"),
  #       domain: System.get_env("MAILGUN_DOMAIN")
  #
  # For this example you need include a HTTP client required by Swoosh API client.
  # Swoosh supports Hackney and Finch out of the box:
  #
  #     config :swoosh, :api_client, Swoosh.ApiClient.Hackney
  #
  # See https://hexdocs.pm/swoosh/Swoosh.html#module-installation for details.
end

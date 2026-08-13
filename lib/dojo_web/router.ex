defmodule DojoWeb.Router do
  use DojoWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {DojoWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/", DojoWeb do
    pipe_through :browser

    get "/", PageController, :home

    live_session :dojo_session,
      on_mount: [{DojoWeb.Session, :anon}] do
      live("/book1", BookOneLive, :index)
      live("/shell", ShellLive, :index)
      live("/welcome", BootLive, :index)

      # The papertiger bench: TigerLive is not in the repo yet, so the route
      # only stands where a missing module is a warning, never a shipped 500.
      if Application.compile_env(:dojo, :dev_routes) do
        live("/tiger", TigerLive, :index)
      end
    end
  end

  scope "/", DojoWeb do
    pipe_through :api

    # The read ladder: a room, a river, a moment, a picture. All open — privacy
    # is residence, and the room holds only what was already shipped. The binds
    # defend authorship on the way IN (id:ka-rule).
    get "/keeps", KeepController, :latest
    # One river, cursored (id:ka-door-shape). Revalidates — a work is a
    # continuant and its head moves.
    get "/keeps/:ref/history", KeepController, :history
    # One moment, for the fork word (id:la-fork-pull).
    get "/keeps/:ref", KeepController, :pull
    # The picture (id:kb-13). Immutable — the id names an occurrent.
    get "/keeps/:id/image", KeepController, :image
  end

  # Enable LiveDashboard and Swoosh mailbox preview in development
  if Application.compile_env(:dojo, :dev_routes) do
    # If you want to use the LiveDashboard in production, you should put
    # it behind authentication and allow only admins to access it.
    # If your application does not have an admins-only section yet,
    # you can use Plug.BasicAuth to set up some basic authentication
    # as long as you are also using SSL (which you should anyway).
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through :browser

      live_dashboard "/dashboard", metrics: DojoWeb.Telemetry
      forward "/mailbox", Plug.Swoosh.MailboxPreview
    end
  end
end

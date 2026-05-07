# PaperLand Dojo

> math with the seriousness one has as a child at play

[PaperLand Dojo](https://dojo.paperland.sg/welcome) is a place where
people explore and wrestle with mathematics together, unveiling the hidden beauty of it 
all through sharing code.

A place where the curious might forge their own path or find one another. 

Want to know more about how we are building it? Head over to [paperland.sg](https://paperland.sg).

## What you'll need

We built this on Elixir and OTP.

| Tool   | Version |
|--------|---------|
| Elixir | ~> 1.18 |
| OTP    | 27+     |

## Getting it running from source
You can install the latest version locally [here](https://github.com/paperlands/dojo/releases/latest)! But if you wish to contribute or run it yourself.

Clone and  dependencies, compile, and bundle assets in one go:

```sh
mix setup
```

Then start the server:

```sh
iex --cookie enterthedojo --dbg pry -S mix phx.server
```

That's it. Visit [localhost:4000](http://localhost:4000) and you're in.

## Running a cluster

PaperLand is yours, but it's always a happier journey together with friends. You can start a second node
on a different machine or port anywhere on the same network:

```sh
PORT=4001 \
  iex --cookie enterthedojo -S mix phx.server
```

Nodes find each other automatically over mDNS (`_erlang._tcp.local`). No config needed. 

Bon Voyage!

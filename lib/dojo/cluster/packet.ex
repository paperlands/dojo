defmodule Dojo.Cluster.MDNS.Packet do
  import Bitwise
  @moduledoc """
  Low-level mDNS (RFC 6762) / DNS-SD (RFC 6763) packet codec.
  https://datatracker.ietf.org/doc/html/rfc6762
  
  Handles the binary wire format for:
  - PTR query packets (service discovery)
  - Announcement response packets (PTR + TXT + A)
  - Full packet decoding with pointer-compressed name support

  ## DNS packet layout (RFC 1035 §4.1)

      +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
      |                      ID                         |
      +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
      |QR|  Opcode  |AA|TC|RD|RA| Z|AD|CD|    RCODE    |
      +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
      |                    QDCOUNT                      |
      +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
      |                    ANCOUNT                      |
      +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
      |                    NSCOUNT                      |
      +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
      |                    ARCOUNT                      |
      +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
      | Questions + Answers + Authority + Additional ... |
      +--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
  """

  ##############################################################################
  # DNS type / class constants
  ##############################################################################

  @type_a     1
  @type_ptr  12
  @type_txt  16
  @type_aaaa 28
  @type_srv  33

  @class_in    1
  # Cache-flush bit for our own records (RFC 6762 §11.3)
  @class_flush 0x8001

  # mDNS query flags: QR=0, Opcode=0, RD=0
  @flags_query    0x0000
  # mDNS response flags: QR=1, AA=1
  @flags_response 0x8400

  ##############################################################################
  # Public API
  ##############################################################################

  @doc """
  Build an mDNS PTR query packet for `service_fqdn` (e.g. `"_erlang._tcp.local"`).

  The packet sets ID=0 and RD=0 as required by RFC 6762 §18.
  QU (unicast-response) bit is not set; we want multicast responses so all
  peers on the link hear the reply and can update their own caches.
  """
  @spec query(String.t()) :: binary()
  def query(service_fqdn) do
    qname = encode_name(service_fqdn)

    <<
      0         :: 16,   # ID  — always 0 for mDNS
      @flags_query :: 16,
      1         :: 16,   # QDCOUNT
      0         :: 16,   # ANCOUNT
      0         :: 16,   # NSCOUNT
      0         :: 16,   # ARCOUNT
      qname     :: binary,
      @type_ptr :: 16,
      @class_in :: 16
    >>
  end

  @doc """
  Build an mDNS announcement response for one `ip` address.

  Emits three resource records:

  1. **PTR** `service_fqdn` → `<instance>.<service_fqdn>`
  2. **TXT** `<instance>.<service_fqdn>` → `erlang_node=<node_basename>@<ip>`
  3. **A**   `<node_basename>.local`    → `ip`

  The instance label is `<node_basename>-<ip-dashes>` so every IP gets a
  distinct instance name, keeping the DNS-SD namespace clean even when a
  node has multiple interfaces.

  Pass `ttl: 0` to emit a RFC 6762 §11.3 "goodbye" packet on shutdown.
  """
  @spec announcement(String.t(), String.t(), :inet.ip4_address(), non_neg_integer(), :inet.port_number()) :: binary()
  def announcement(service_fqdn, own_name_str, ip, ttl, port) do
  # own_name_str is already "admin@<uuid>" — use it directly
  instance_lbl  = String.replace(own_name_str, ~r/[@\-]/, "-")
  instance_fqdn = "#{instance_lbl}.#{service_fqdn}"
  # Use only the basename part for the A record host
  host_local    = (own_name_str |> String.split("@") |> hd()) <> ".local"

  ptr_rr = rr(service_fqdn,  @type_ptr,   @class_in,    ttl, encode_name(instance_fqdn))
  srv_rdata = <<0::16, 0::16, port::16, encode_name(host_local)::binary>>
  srv_rr    = rr(instance_fqdn, @type_srv, @class_flush, ttl, srv_rdata)
  # 3. ADD partisan_port to TXT
  txt_rr = rr(instance_fqdn, @type_txt, @class_flush, ttl,
    encode_txt([
      {"erlang_node",   own_name_str},
      {"partisan_port", Integer.to_string(port)}
    ]))
  a_rr = rr(host_local, @type_a, @class_flush, ttl, encode_a(ip))

    <<
      0               :: 16,
      @flags_response :: 16,
      0               :: 16,   # QDCOUNT = 0
      4               :: 16,   # ANCOUNT = 4  (PTR + SRV + TXT + A)
      0               :: 16,   # NSCOUNT
      0               :: 16,   # ARCOUNT
      ptr_rr          :: binary,
      srv_rr          :: binary,
      txt_rr          :: binary,
      a_rr            :: binary
    >>
  end

  @doc """
  Decode a raw mDNS UDP payload into a flat list of resource-record maps.

  Returns `{:ok, records}` or `{:error, reason}`.

  Each record is a map with at least:

      %{
        name:  "some.label.local",
        type:  12,          # @type_ptr etc.
        class: 1,           # RCLASS with cache-flush bit masked out
        ttl:   120,
        data:  {:ptr, "instance.service.local"}   # decoded RDATA
      }

  Possible `:data` variants:

  * `{:ptr,  name_string}`
  * `{:txt,  [{key, value}]}`
  * `{:a,    {a, b, c, d}}`
  * `{:aaaa, {a, b, c, d, e, f, g, h}}`
  * `{:srv,  %{priority, weight, port, target}}`
  * `{:unknown, binary}`
  """
  @spec decode(binary()) :: {:ok, [map()]} | {:error, term()}
  def decode(raw) when is_binary(raw) do
    try do
      decode!(raw)
    rescue
      e -> {:error, e}
    end
  end

  def decode(_), do: {:error, :not_binary}

  ##############################################################################
  # Decoder internals
  ##############################################################################

  defp decode!(<<
    _id      :: 16,
    _qr      :: 1,
    _opcode  :: 4,
    _aa      :: 1,
    _tc      :: 1,
    _rd      :: 1,
    _ra      :: 1,
    _z       :: 3,
    _rcode   :: 4,
    qdcount  :: 16,
    ancount  :: 16,
    nscount  :: 16,
    arcount  :: 16,
    rest     :: binary
  >> = pkt) do
    {_,   r1} = skip_questions(pkt, rest,  qdcount)
    {ans, r2} = decode_rrs(pkt, r1, ancount)
    {_,   r3} = decode_rrs(pkt, r2, nscount)
    {add, _}  = decode_rrs(pkt, r3, arcount)
    {:ok, ans ++ add}
  end

  defp decode!(_), do: throw(:bad_header)

  # ---------------------------------------------------------------------------
  # Question section — skip over (we only care about answers/additional)
  # ---------------------------------------------------------------------------

  defp skip_questions(_pkt, data, 0), do: {[], data}

  defp skip_questions(pkt, data, n) do
    {_, rest}                     = read_name(pkt, data)
    <<_type::16, _class::16, r2::binary>> = rest
    skip_questions(pkt, r2, n - 1)
  end

  # ---------------------------------------------------------------------------
  # Resource record decoder
  # ---------------------------------------------------------------------------

  defp decode_rrs(_pkt, data, 0), do: {[], data}

  defp decode_rrs(pkt, data, n) do
    {name, rest}  = read_name(pkt, data)

    <<
      type  :: 16,
      class :: 16,
      ttl   :: 32,
      rdlen :: 16,
      rdata :: binary-size(rdlen),
      rest2 :: binary
    >> = rest

    rr = %{
      name:  name,
      type:  type,
      class: class &&& 0x7FFF,   # strip cache-flush bit
      ttl:   ttl,
      data:  decode_rdata(type, pkt, rdata)
    }

    {more, rest3} = decode_rrs(pkt, rest2, n - 1)
    {[rr | more], rest3}
  end

  # ---------------------------------------------------------------------------
  # RDATA decoders
  # ---------------------------------------------------------------------------

  defp decode_rdata(@type_ptr, pkt, rdata) do
    {pointed, _} = read_name(pkt, rdata)
    {:ptr, pointed}
  end

  defp decode_rdata(@type_txt, _pkt, rdata) do
    {:txt, parse_txt(rdata, [])}
  end

  defp decode_rdata(@type_a, _pkt, <<a, b, c, d>>) do
    {:a, {a, b, c, d}}
  end

  defp decode_rdata(@type_aaaa, _pkt, <<
    a::16, b::16, c::16, d::16,
    e::16, f::16, g::16, h::16
  >>) do
    {:aaaa, {a, b, c, d, e, f, g, h}}
  end

  defp decode_rdata(@type_srv, pkt, <<
    priority :: 16,
    weight   :: 16,
    port     :: 16,
    rest     :: binary
  >>) do
    {target, _} = read_name(pkt, rest)
    {:srv, %{priority: priority, weight: weight, port: port, target: target}}
  end

  defp decode_rdata(_type, _pkt, rdata), do: {:unknown, rdata}

  # ---------------------------------------------------------------------------
  # TXT RDATA: sequence of length-prefixed strings, each "key=value"
  # ---------------------------------------------------------------------------

  defp parse_txt(<<>>, acc), do: Enum.reverse(acc)

  defp parse_txt(<<len :: 8, str :: binary-size(len), rest :: binary>>, acc) do
    entry =
      case String.split(str, "=", parts: 2) do
        [k, v] -> {k, v}
        [k]    -> {k, ""}
      end
    parse_txt(rest, [entry | acc])
  end

  defp parse_txt(_, acc), do: Enum.reverse(acc)  # truncated — return what we have

  ##############################################################################
  # DNS name reader — RFC 1035 §4.1.4 pointer compression
  #
  # Labels:       <<len(< 64), label_bytes...>>
  # Pointer:      <<0b11::2, offset::14>>  → jump to offset in full packet
  # End of name:  <<0>>
  ##############################################################################

  @doc false
  def read_name(full_pkt, data), do: read_labels(full_pkt, data, [])

  defp read_labels(_pkt, <<0, rest :: binary>>, acc) do
    name = acc |> Enum.reverse() |> Enum.join(".")
    {name, rest}
  end

  defp read_labels(pkt, <<len, rest :: binary>>, acc) when len > 0 and len < 64 do
    <<label :: binary-size(^len), remaining :: binary>> = rest
    read_labels(pkt, remaining, [label | acc])
  end

  # Compression pointer: 2 high bits = 11
  defp read_labels(pkt, <<0b11 :: 2, ptr :: 14, caller_rest :: binary>>, acc) do
    # Jump into the original packet at `ptr`; ignore the rest from that path
    target   = :binary.part(pkt, ptr, byte_size(pkt) - ptr)
    {suffix, _} = read_labels(pkt, target, [])

    prefix_parts = Enum.reverse(acc)
    full =
      case prefix_parts do
        [] -> suffix
        _  -> Enum.join(prefix_parts, ".") <> if(suffix == "", do: "", else: "." <> suffix)
      end

    # Return with the original `caller_rest` — 2 bytes consumed for the pointer
    {full, caller_rest}
  end

  # Safety: unrecognised label length — return what we have
  defp read_labels(_pkt, rest, acc) do
    {acc |> Enum.reverse() |> Enum.join("."), rest}
  end

  ##############################################################################
  # DNS encoder helpers
  ##############################################################################

  # Single resource record
  defp rr(name, type, class, ttl, rdata) do
    rdlen = byte_size(rdata)
    <<encode_name(name) :: binary, type :: 16, class :: 16, ttl :: 32, rdlen :: 16, rdata :: binary>>
  end

  @doc """
  Encode a dot-separated DNS name as a sequence of length-prefixed labels,
  terminated by a zero octet.

      iex> Cluster.Strategy.MDNS.Packet.encode_name("_erlang._tcp.local")
      <<8, 95, 101, 114, 108, 97, 110, 103, 4, 95, 116, 99, 112, 5, 108, 111, 99, 97, 108, 0>>
  """
  @spec encode_name(String.t()) :: binary()
  def encode_name(name) do
    parts =
      name
      |> String.split(".")
      |> Enum.map(fn label -> <<byte_size(label) :: 8, label :: binary>> end)

    IO.iodata_to_binary(parts ++ [<<0>>])
  end

  # TXT RDATA: list of {key, value} → length-prefixed "key=value" strings
  defp encode_txt(pairs) do
    IO.iodata_to_binary(
      Enum.map(pairs, fn {k, v} ->
        s = "#{k}=#{v}"
        <<byte_size(s) :: 8, s :: binary>>
      end)
    )
  end

  # A record RDATA: 4-byte IPv4 address
  defp encode_a({a, b, c, d}), do: <<a, b, c, d>>
end

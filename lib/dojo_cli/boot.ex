defmodule DojoCLI.Boot do


  def splash() do
    "


                                                ^7?JY5PJ                                            
                                               7PPPPPPP!                                            
                                              ^PPPPP5?~                                             
                                              7PPPPY.                                               
                                              ?PPPP?                                                
                                              ?PPPPJ                                   .            
        ^^^^^                                 ?PPPP5.                               .7Y5J^          
       !PPPPP:                                JPPPPJ.                              !5PPPPPJ:        
      .YPPPPPJ:                               YPPJ~                              ^JPPPPP55P5.       
       .^JPPPPPY?77!~:                        ~~:                              :?PPPPP?^.:^^        
          :7YPPPPPPPPPJ.                                                     .?PPPPP5^              
             :~!?YPPPPP!                    .:^!????77!~~^:.                 !PPPPPP~               
                  :~7?7.             .:~7?YY5PPPPPPPPPPPPPP5YJ?!:            .J5YJ!:                
                                  ^!J5PPPPPPP5YYJJJ???JJJY5PPPPPPY!.           .                    
                               ^7YPPPPPY?!~:..            .:~J5PPPP57:                              
                             ~YPPPPPY!:     .:::::::....      .!YPPPP57.                            
                           :JPPPPY!:     .~?5PPPPPPPP555YJJ7!^   ~YPPPPY^                           
                          !5PPPP7      ^?5PPPPPPP5YY555PPPPPPP5!   !5PPPP!                          
::.                      !PPPPY^     ^JPPPPPP5?~       :^~7JPPPP?.  :YPPPP7                         
5P5Y!                   ^PPPPJ.     7PPPPPPY~.  ^???!:      :JPPPY.  .?PPPP!                        
JPPPP?~^::::::         .YPPP5:     7PPPPPJ~    ^!~^^~!~.     .YPPPY.   !PPPP~      ...              
~5PPPPPPPPPPPPJ^       !PPPPJ     .Y5Y?!:                     .7JY5J    ~PPP5:     JP5YYJJ?77!!~:.  
 .~7JYY5555PPPPP7      YPP55!      .                              .:     !55P?     .JPPPPPPPPPPPP57.
       ....::^^~~      ~~^..                                               .::       ^?????JJYPPPPP?
                                                                                              :YPPPY
                                            .:^~7?J?7~^:.                                      :7JYJ
                                    .:^~!?JY5PPPPPPPPPPP5YJ?!~^:.                                   
                            ..  :?JY5PPPPPPPP5YJ?7!7?JY5PPPPPPPP5YJ7:  ..                           
                     .:^!7JY5Y  7PPPPP5YJ7!^:.         .:^!7?J55PPPP7 .Y5Y?7!^:.                    
             .:^~7?JY5PPPPPPP5. 7?!~^       :^!7?YYY?7!^:      .:~!?! .5PPPPPPP5YJ?7~^:.            
         ~?JY5PPPPPPPP55YPPPP5      .^~7?^ .5PPPPPPPPPPPY  ~?!~^:.    .5PPPPY55PPPPPPPP5YJ?~        
         ?PPPP5YJ?!~^:. .YPPP5~!7JY5PPPPPJ .5PPPY~!~YPPPY  JPPPPP5YJ?!~5PPPY  .:^~!?JY5PPPP7        
         .~^::.  ^!?J?~!JPPPPPPPPPPP5YJ?7^ .5PPP?   JPPPY  ^7?JY5PPPPPPPPPPP?!~?J?!:  .:^^~.        
            .:^!JPPPPPPPPPPP5YY?7!^:.      .5PPPJ   JPPPY       .:^!7?YY5PPPPPPPPPPPJ!^:.           
         :JY5PPPPPPPPPYJ?!~^::             .5PPPJ   JPPPY              .:^^!7JYPPPPPPPPP5YJ.        
         :PPP5YJ?5PPPJ   :?JYY.            .5PPPJ   JPPPY              75Y?^  :5PPP5?JY5PPP.        
          ^^:.   YPPPJ   7PPP5.            .5PPPJ   JPPPY              5PPP?  .5PPPY   .:^:         
                 YPPPJ   ?PPP5.            .5PPPJ   JPPPY             .5PPP?  .5PPPY                
                 YPPPJ   ?PPP5.            .5PPPJ   JPPPY             .5PPP?  .5PPPY                
                 YPPPJ   JPPP5.            .5PPPJ   JPPPY             .5PPP?  .5PPPY                
                 YPPPJ   JPPP5.            .5PPPJ   JPPPY             .5PPP?  .5PPPY                
                 YPPPJ   JPPP5.            .5PPPJ   JPPPY             .5PPP?   YPPPY                
                 YPPPJ   JPPP5.            .5PPPJ   JPPPY             .5PPP?   YPPPY                
                 YPPPJ   JPPP5.            .5PPPJ   JPPPY             .5PPP?   YPPPY                
                .YPPPJ   JPPP5.            .5PPPJ   JPPPY.            .5PPP?   YPPPY.               
             ~5YYPPPPJ   JPPP5.          JYYPPPPJ   JPPPPY5J          .5PPP?   YPPPPYY5~            
             !PPPPPPPJ   JPPP5.          YPPPPPPJ   JPPPPPPY          .5PPP?   YPPPPPPP~

  "

  end

  def display() do
    box_width = 100
    
    # ANSI escape codes
    reset = IO.ANSI.reset()
    bold = IO.ANSI.bright()
    dim = IO.ANSI.faint()
    red = IO.ANSI.red()
    green = IO.ANSI.green()
    white = IO.ANSI.white()
    orange = IO.ANSI.color(214)
    
    # Box drawing characters
    top_left = "╭"
    top_right = "╮"
    bottom_left = "╰"
    bottom_right = "╯"
    horizontal = "─"
    vertical = "│"
    left_fleuron = "☙"
    right_fleuron = "❧"
    center_ornament = "🔆"
    inner_width = box_width - 6
    
    # Create hyperlinks (OSC 8 standard - works in modern terminals)
    ip_link = "http://#{get_local_ip()}:#{4000}"
    
    # Hyperlink format: \e]8;;URL\e\\TEXT\e]8;;\e\\
    ip_hyperlink = "\e]8;;#{ip_link}\e\\#{red}#{get_local_ip()}:4000#{reset}\e]8;;\e\\"

    
    # Build the box
    IO.puts(orange<>splash())
    IO.puts("\n")
    # Fleurons at the ends with strong center ornament
    

    # Calculate the line segments between fleurons and center
    # Format: ☙ ─── ✦ ─── ❧
    total_fleuron_length = String.length(left_fleuron) + String.length(right_fleuron) + String.length(center_ornament)
    remaining_space = max(0, inner_width - total_fleuron_length - 4) # 4 for the spaces around ornaments

    # Divide the remaining space for lines on each side
    line_length = div(remaining_space, 2)
    line = String.duplicate("─", line_length)

    # Build the complete fleuron separator
    fleuron_separator = "#{left_fleuron} #{line} #{center_ornament} #{line} #{right_fleuron}"

    IO.puts("#{dim}#{top_left}#{String.duplicate(horizontal, box_width - 2)}#{top_right}#{reset}")
    IO.puts("#{dim}#{vertical}#{reset}#{String.duplicate(" ", box_width - 2)}#{dim}#{vertical}#{reset}")
    
    # Title
    title = "Ready to enter PaperLand?"
    padding = div(box_width - 2 - String.length(title), 2)
    IO.puts("#{dim}#{vertical}#{reset}#{String.duplicate(" ", padding)}#{bold}#{orange}#{IO.ANSI.blink_slow()}#{title}#{reset}#{String.duplicate(" ", box_width - 2 - padding - String.length(title))}#{dim}#{vertical}#{reset}")
    
    IO.puts("#{dim}#{vertical}#{reset}#{String.duplicate(" ", box_width - 2)}#{dim}#{vertical}#{reset}")

    
    # Seperator
    IO.puts("#{dim}#{vertical}#{reset}  #{orange}#{fleuron_separator}#{reset}   #{dim}#{vertical}#{reset}")
    IO.puts("#{dim}#{vertical}#{reset}#{String.duplicate(" ", box_width - 2)}#{dim}#{vertical}#{reset}")
    
    # Local IP info
    label = "URL LINK:"
    # Calculate visible length without ANSI codes for proper spacing
    ip_visible = "#{get_local_ip()}:4000"
    spacing = box_width - 2 - 4 - String.length(label) - String.length(ip_visible) - 2
    IO.puts("#{dim}#{vertical}#{reset}    #{white}#{label}#{reset}  #{ip_hyperlink}#{String.duplicate(" ", spacing)}#{dim}#{vertical}#{reset}")
    
    IO.puts("#{dim}#{vertical}#{reset}#{String.duplicate(" ", box_width - 2)}#{dim}#{vertical}#{reset}")
    
    IO.puts("#{dim}#{vertical}#{reset}#{String.duplicate(" ", box_width - 2)}#{dim}#{vertical}#{reset}")
    IO.puts("#{dim}#{bottom_left}#{String.duplicate(horizontal, box_width - 2)}#{bottom_right}#{reset}")
    
    IO.puts("\n#{green}  Remember to be in the same Local Wifi or Ethernet Network#{reset}")
    IO.puts("\n#{dim}  Press Ctrl+C to stop#{reset}\n")
  end

   @doc """
  Gets the local IP address that other devices on the same LAN can use.
  Returns the first active physical network interface with a private IP.
  """
  def get_local_ip do
    # Windows-specific: Try querying hostname first (more reliable on Windows)
    ip = case :os.type() do
      {:win32, _} -> try_windows_hostname_method()
      _ -> nil
    end

    # Fall back to interface enumeration
    ip || case :inet.getifaddrs() do
      {:ok, ifaddrs} ->
        ifaddrs
        |> filter_physical_interfaces()
        |> find_best_lan_ip()
        |> case do
          nil -> "127.0.0.1"
          ip -> ip
        end

      _ -> "127.0.0.1"
    end
  end

  # Windows-specific: Use hostname resolution which is more reliable
  defp try_windows_hostname_method do
    with {:ok, hostname} <- :inet.gethostname(),
         {:ok, {:hostent, _, _, :inet, _, addresses}} <- :inet.gethostbyname(hostname) do
      
      # Find first private IP (skip 127.0.0.1)
      addresses
      |> Enum.find(fn ip -> 
        is_private_ip(ip) and ip != {127, 0, 0, 1}
      end)
      |> case do
        nil -> nil
        ip -> ip |> :inet.ntoa() |> to_string()
      end
    else
      _ -> nil
    end
  end

  # Filter to only physical network interfaces
  defp filter_physical_interfaces(ifaddrs) do
    ifaddrs
    |> Enum.filter(fn {iface, opts} ->
      is_physical_interface(iface) and 
      is_interface_up(opts) and
      has_broadcast(opts)
    end)
  end

  defp is_physical_interface(iface) do
    iface_str = to_string(iface) |> String.downcase()
    
    # Windows interface names are different - they use GUIDs or descriptive names
    # Examples: "{GUID}", "local area connection", "ethernet", "wi-fi", "wireless"
    
    # Unix/Linux physical interfaces
    physical_patterns = ["eth", "en", "wlan", "wlp", "eno", "ens", "em", "wl"]
    
    # Virtual/tunnel interfaces to block
    virtual_patterns = ["lo", "docker", "vbox", "vmnet", "veth", "tun", "tap", 
                        "utun", "wg", "br-", "virbr", "vmware", "hyper-v"]
    
    # Check if it's a virtual interface first
    is_virtual = Enum.any?(virtual_patterns, fn pattern ->
      String.contains?(iface_str, pattern)
    end)
    
    if is_virtual do
      false
    else
      # For Unix: must start with physical pattern
      # For Windows: allow anything that's not virtual (Windows uses GUIDs/descriptive names)
      is_unix_physical = Enum.any?(physical_patterns, &String.starts_with?(iface_str, &1))
      
      # If it looks like a Unix interface, require physical pattern
      # Otherwise (Windows GUIDs, etc), allow it through
      looks_like_unix = String.match?(iface_str, ~r/^[a-z]+\d/)
      
      if looks_like_unix do
        is_unix_physical
      else
        # Windows or other - allow if not virtual
        true
      end
    end
  end

  defp is_interface_up(opts) do
    # Check if interface has UP and RUNNING flags
    flags = Keyword.get(opts, :flags, [])
    :up in flags and :running in flags
  end

  defp has_broadcast(opts) do
    # Interface should have broadcast capability (physical networks do, point-to-point don't)
    flags = Keyword.get(opts, :flags, [])
    :broadcast in flags
  end

  defp find_best_lan_ip(interfaces) do
    # Get all candidate IPs with priority scores
    candidates = 
      interfaces
      |> Enum.flat_map(fn {iface, opts} ->
        opts
        |> Keyword.get_values(:addr)
        |> Enum.filter(&is_ipv4/1)
        |> Enum.filter(&is_private_ip/1)
        |> Enum.map(fn ip ->
          {ip, calculate_priority(iface, ip)}
        end)
      end)
      |> Enum.sort_by(fn {_ip, priority} -> priority end)

    case candidates do
      [{ip, _priority} | _] -> ip |> :inet.ntoa() |> to_string()
      [] -> nil
    end
  end

  defp calculate_priority(iface, ip) do
    iface_str = to_string(iface)
    
    # Lower number = higher priority
    interface_priority = cond do
      # Prefer wired over wireless
      String.starts_with?(iface_str, "eth") -> 10
      String.starts_with?(iface_str, "en") and String.contains?(iface_str, "p") -> 11  # enp (wired)
      String.starts_with?(iface_str, "eno") -> 12  # onboard ethernet
      String.starts_with?(iface_str, "ens") -> 13  # systemd naming
      String.starts_with?(iface_str, "em") -> 14   # BSD ethernet
      
      # Wireless interfaces
      String.starts_with?(iface_str, "wlan") -> 20
      String.starts_with?(iface_str, "wlp") -> 21
      String.starts_with?(iface_str, "wl") -> 22
      
      # Generic en* (macOS - could be either)
      String.starts_with?(iface_str, "en") -> 25
      
      true -> 30
    end

    # IP range priority (prefer common home/office networks)
    ip_priority = case ip do
      {192, 168, _, _} -> 0   # Most common home/office
      {10, _, _, _} -> 5      # Enterprise networks
      {172, s, _, _} when s >= 16 and s <= 31 -> 10  # Less common
      {100, s, _, _} when s >= 64 and s <= 127 -> 20  # CGNAT (often mobile hotspot)
      _ -> 50
    end

    interface_priority + ip_priority
  end

  defp is_ipv4(addr) when is_tuple(addr), do: tuple_size(addr) == 4
  defp is_ipv4(_), do: false

  defp is_private_ip(ip) do
    case ip do
      {192, 168, _, _} -> true
      {10, _, _, _} -> true
      {172, second, _, _} when second >= 16 and second <= 31 -> true
      {100, second, _, _} when second >= 64 and second <= 127 -> true  # CGNAT
      _ -> false
    end
  end

  @doc """
  Gets all available LAN IPs (useful for multi-homed systems).
  Returns list of {interface, ip} tuples.
  """
  def get_all_lan_ips do
    case :inet.getifaddrs() do
      {:ok, ifaddrs} ->
        ifaddrs
        |> Enum.filter(fn {iface, opts} ->
          # On Windows, be more lenient - just check if it's up and has broadcast
          case :os.type() do
            {:win32, _} -> 
              is_interface_up(opts) and has_broadcast(opts)
            _ -> 
              is_physical_interface(iface) and is_interface_up(opts) and has_broadcast(opts)
          end
        end)
        |> Enum.flat_map(fn {iface, opts} ->
          opts
          |> Keyword.get_values(:addr)
          |> Enum.filter(&is_ipv4/1)
          |> Enum.filter(&is_private_ip/1)
          |> Enum.filter(fn ip -> ip != {127, 0, 0, 1} end)
          |> Enum.map(fn ip ->
            {to_string(iface), ip |> :inet.ntoa() |> to_string()}
          end)
        end)

      _ -> []
    end
  end
end

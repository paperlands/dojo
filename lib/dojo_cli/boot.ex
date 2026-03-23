defmodule DojoCLI.Boot do


  defdelegate open(url), to: DojoCLI.Browser
  defdelegate open_sync(url), to: DojoCLI.Browser

  @doc """
  Opens URL and prints fallback message if browser unavailable.

  This is the UX pattern for CLI apps: attempt to open browser,
  but give user the URL if that fails.
  """
  def open_with_fallback(url, device \\ :stdio) do
    case open_sync(url) do
      :ok ->
        :ok

      {:error, _} ->
        IO.puts(device, "\nOpen in your browser: #{url}")
        :ok
    end
  end



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

  @doc """
  Prints the splash box to stdout. Safe to call before the supervision tree starts.
  Does NOT open the browser — use `display/0` for that after the endpoint is ready.
  """
  def print_splash() do
    display(open_browser: false)
  end

  def display() do
    display(open_browser: true)
  end

  defp display(opts) do
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
    ip_link = "http://127.0.0.1:#{System.get_env("PORT") || 4000}"
    #System.put_env("MY_IP_ADDR", "#{get_local_ip()}:#{System.get_env("PORT") || 4000}")
    
    
    # Hyperlink format: \e]8;;URL\e\\TEXT\e]8;;\e\\
    ip_hyperlink = "\e]8;;#{ip_link}\e\\#{red}localhost:#{System.get_env("PORT") || 4000}#{reset}\e]8;;\e\\"

    
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
    IO.puts("#{dim}#{vertical}#{reset}  #{orange}#{fleuron_separator}#{reset}  #{dim}#{vertical}#{reset}")
    IO.puts("#{dim}#{vertical}#{reset}#{String.duplicate(" ", box_width - 2)}#{dim}#{vertical}#{reset}")
    
    # Local IP info
    label = "URL LINK:"
    # Calculate visible length without ANSI codes for proper spacing
    ip_visible = "127.0.0.1:#{System.get_env("PORT") || "4000"}" 
    spacing = box_width - 2 - 4 - String.length(label) - String.length(ip_visible) - 2
    IO.puts("#{dim}#{vertical}#{reset}    #{white}#{label}#{reset}  #{ip_hyperlink}#{String.duplicate(" ", spacing)}#{dim}#{vertical}#{reset}")
    
    IO.puts("#{dim}#{vertical}#{reset}#{String.duplicate(" ", box_width - 2)}#{dim}#{vertical}#{reset}")
    
    IO.puts("#{dim}#{vertical}#{reset}#{String.duplicate(" ", box_width - 2)}#{dim}#{vertical}#{reset}")
    IO.puts("#{dim}#{bottom_left}#{String.duplicate(horizontal, box_width - 2)}#{bottom_right}#{reset}")
    
    IO.puts("\n#{green}  Remember to connect to the same Local Area Network Wifi or Ethernet Network#{reset}")
    if Keyword.get(opts, :open_browser, true) do
      open_with_fallback(ip_visible <> "/welcome")
    end
    IO.puts("\n#{dim}  Press Ctrl+C to stop#{reset}\n")
  end
end

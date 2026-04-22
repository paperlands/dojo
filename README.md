# PaperLand Dojo

> math with the seriousness one has as a child at play

``` 
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

```

A learning environment crafted for exploring mathematics together across machines or timezones built on the backbone of OTP and Elixir.
[Live at dojo.paperland.sg](dojo.paperland.sg)
[Learn more about PaperLand](paperland.sg)

## Requirements

| Tool | Version |
|---|---|
| Elixir | ~> 1.18 |
| OTP | 27+ |

## Setup

```sh
mix setup        # deps, compile, assets
```

## Run

```sh
iex  --cookie enterthedojo --dbg pry -S mix phx.server
```

Visit [localhost:4000](http://localhost:4000).

## Cluster (multi-node)

Start a second node on the same network:

```sh
PORT=4001 \
  iex --cookie enterthedojo -S mix phx.server
```

Nodes discover each other via mDNS (`_erlang._tcp.local`). Zero configuration required.

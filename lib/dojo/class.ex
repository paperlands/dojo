defmodule Dojo.Class do
  def join(pid, book, disciple) do
    topic = "class:" <> book
    Dojo.Gate.track(pid, topic, disciple)
  end

  def whereis(username, book) do
    Dojo.Gate.get_by_key("class:" <> book, username)
  end

  def listen(book) do
    topic = "class:" <> book
    Dojo.PubSub.subscribe(topic)
  end
end

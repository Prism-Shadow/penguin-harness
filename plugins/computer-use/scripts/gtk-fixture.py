#!/usr/bin/python3 -I
"""A GTK3 window for the computer-use smoke on Linux.

Every control has a unique accessible name, since a Linux ref resolves only for an element that
is unique in its window, and every action shows its effect in a label that a later read can check.
"""
import gi

gi.require_version("Gtk", "3.0")
from gi.repository import Gtk  # noqa: E402


class Fixture(Gtk.Window):
    def __init__(self):
        super().__init__(title="Computer Use Smoke")
        self.set_default_size(420, 260)
        self.clicks = 0
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=6, margin=8)
        self.add(box)
        self.entry = Gtk.Entry()
        self.entry.get_accessible().set_name("Name field")
        box.pack_start(self.entry, False, False, 0)
        greet = Gtk.Button(label="Greet")
        greet.connect("clicked", self.on_greet)
        box.pack_start(greet, False, False, 0)
        self.greeting = Gtk.Label(label="Greeting: none")
        box.pack_start(self.greeting, False, False, 0)
        inc = Gtk.Button(label="Increment")
        inc.connect("clicked", self.on_inc)
        box.pack_start(inc, False, False, 0)
        self.counter = Gtk.Label(label="Clicks: 0")
        box.pack_start(self.counter, False, False, 0)
        self.connect("destroy", Gtk.main_quit)

    def on_greet(self, _button):
        self.greeting.set_text(f"Greeting: Hello, {self.entry.get_text() or 'nobody'}")

    def on_inc(self, _button):
        self.clicks += 1
        self.counter.set_text(f"Clicks: {self.clicks}")


if __name__ == "__main__":
    window = Fixture()
    window.show_all()
    Gtk.main()

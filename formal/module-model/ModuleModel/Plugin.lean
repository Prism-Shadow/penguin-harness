import ModuleModel.Pass

/-!
A plugin names declarations and a pass. A fixed catalog supplies precedence and
revisions. Enabled names are a set represented by membership in a list: request
order and duplicate requests have no effect.

Reconfiguration always evaluates from `base`. A previous result is never an input
to `build`. This is logical configuration, not loading, parking, disposal, or npm.
-/
namespace ModuleModel

structure Plugin where
  name : Name
  declarations : Module
  pass : Pass

namespace Plugin

def catalogValid (catalog : List Plugin) : Prop := (catalog.map Plugin.name).Nodup

def selected (catalog : List Plugin) (enabled : List Name) : List Plugin :=
  catalog.filter (fun plugin => enabled.contains plugin.name)

def source (base : Module) (catalog : List Plugin) (enabled : List Name) : Module :=
  base ++ (selected catalog enabled).flatMap Plugin.declarations

def program (catalog : List Plugin) (enabled : List Name) : Pass :=
  Pass.pipe ((selected catalog enabled).map Plugin.pass)

def build (base : Module) (catalog : List Plugin) (enabled : List Name) : Module :=
  (program catalog enabled).run (source base catalog enabled)

def install (name : Name) (enabled : List Name) : List Name :=
  if enabled.contains name then enabled else name :: enabled

def uninstall (name : Name) (enabled : List Name) : List Name :=
  enabled.filter (fun other => other != name)

/-- Process-wide requests are a union by membership. -/
def effective (requests : List (List Name)) : List Name := requests.flatten

/-- A retry may choose any strictly smaller retained selection. No optimality is promised. -/
def Retires (next current : List Name) : Prop :=
  (∀ name, name ∈ next → name ∈ current) ∧
  ∃ name, name ∈ current ∧ name ∉ next

end Plugin
end ModuleModel

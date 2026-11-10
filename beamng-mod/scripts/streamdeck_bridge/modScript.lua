-- Stream Deck Bridge: loads the GE extension when the mod is activated.
local name = 'streamdeckBridge'

if extensions and extensions.load then
  extensions.load(name)
else
  load(name)
end

-- keep the bridge alive across level changes
if setExtensionUnloadMode then
  setExtensionUnloadMode(name, 'manual')
elseif extensions and extensions.setExtensionUnloadMode then
  extensions.setExtensionUnloadMode(name, 'manual')
end

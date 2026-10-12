-- Choreon file bridge for DaVinci Resolve (works with the free version: no io, no Python).
-- Install: copy this file to Fusion/Scripts/Utility (see README), then in Resolve run
-- Workspace > Scripts > choreon_bridge. It executes <home>/choreon_bridge/cmd_<n>.lua and writes
-- res_<n>.prefs. Set CHOREON_BRIDGE_DIR to use another folder (same as RESOLVE_BRIDGE_DIR on the server).
local HOME = (os.getenv and (os.getenv("USERPROFILE") or os.getenv("HOME"))) or ""
local DIR = ((os.getenv and os.getenv("CHOREON_BRIDGE_DIR")) or (HOME .. "/choreon_bridge")):gsub(string.char(92), "/") .. "/"
bmd.createdir(DIR)
local IDLE_LIMIT = 14400 -- seconds without command before auto-stop (4 h)

local BS, DQ = string.char(92), string.char(34)
local function esc(s)
  local out = {}
  for i = 1, #s do
    local c = s:sub(i, i)
    local b = c:byte()
    if c == DQ or c == BS then out[#out+1] = BS .. c
    elseif b == 10 then out[#out+1] = BS .. "n"
    elseif b == 13 then out[#out+1] = BS .. "r"
    elseif b == 9 then out[#out+1] = BS .. "t"
    elseif b < 32 then out[#out+1] = BS .. string.format("u%04x", b)
    else out[#out+1] = c end
  end
  return table.concat(out)
end

local function enc(v, depth)
  depth = depth or 0
  if depth > 12 then return '"<depth>"' end
  local t = type(v)
  if t == "nil" then return "null"
  elseif t == "boolean" then return tostring(v)
  elseif t == "number" then
    if v ~= v or v == math.huge or v == -math.huge then return '"' .. tostring(v) .. '"' end
    return tostring(v)
  elseif t == "string" then return '"' .. esc(v) .. '"'
  elseif t == "table" then
    local n, maxk = 0, 0
    for k in pairs(v) do
      n = n + 1
      if type(k) == "number" and k > 0 and math.floor(k) == k then
        if k > maxk then maxk = k end
      else maxk = -1 end
    end
    local parts = {}
    if n > 0 and maxk == n then
      for i = 1, n do parts[i] = enc(v[i], depth + 1) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    for k, val in pairs(v) do
      parts[#parts+1] = '"' .. esc(tostring(k)) .. '":' .. enc(val, depth + 1)
    end
    return "{" .. table.concat(parts, ",") .. "}"
  else
    return '"' .. esc(tostring(v)) .. '"'
  end
end
ChoreonJSON = enc

-- No io in free 21.1: results go out through Fusion's SavePrefs, hex-encoded.
local function hex(s)
  return (s:gsub(".", function(c) return string.format("%02x", c:byte()) end))
end
local function write(path, s)
  fu:SetPrefs("Global.ChoreonResult", hex(s))
  fu:SavePrefs(path)
  fu:SetPrefs("Global.ChoreonResult", "")
end

local n = 1
local last = os.time()
write(DIR .. "status.prefs", enc({state = "running", pid = bmd.getpid(), started = os.time(), next = n}))

while true do
  if bmd.fileexists(DIR .. "stop_" .. n .. ".flag") then break end
  local cmd = DIR .. "cmd_" .. n .. ".lua"
  if bmd.fileexists(cmd) then
    bmd.wait(0.05) -- let the writer finish
    local t0 = os.clock()
    local res
    local chunk, lerr = loadfile(cmd)
    if not chunk then
      res = {ok = false, error = "load: " .. tostring(lerr)}
    else
      local packed = {pcall(chunk)}
      if packed[1] then
        res = {ok = true, result = packed[2]}
      else
        res = {ok = false, error = tostring(packed[2])}
      end
    end
    res.id = n
    res.ms = math.floor((os.clock() - t0) * 1000)
    local ok, s = pcall(enc, res)
    if not ok then s = enc({id = n, ok = false, error = "encode: " .. tostring(s)}) end
    write(DIR .. "res_" .. n .. ".prefs", s)
    n = n + 1
    last = os.time()
  else
    if os.time() - last > IDLE_LIMIT then break end
    bmd.wait(0.1)
  end
end
write(DIR .. "status.prefs", enc({state = "stopped", stopped = os.time(), next = n}))
print("choreon_bridge stopped")

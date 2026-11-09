export const PUT = `
local prefix = ARGV[1]
local mode, id, json, expRev, slug, score, folder = ARGV[2], ARGV[3], ARGV[4], ARGV[5], ARGV[6], ARGV[7], ARGV[8]
local newTags = cjson.decode(ARGV[9])
local cur = redis.call('GET', KEYS[1])
local old = nil
if mode == 'create' then
  if cur then return {'EXISTS', cur} end
  if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[10]) then return {'CAPACITY'} end
else
  if not cur then return {'MISSING'} end
  old = cjson.decode(cur)
  if tonumber(old.rev) ~= tonumber(expRev) then return {'REV', cur} end
end
if slug ~= '' then
  local owner = redis.call('GET', prefix .. 'slug:' .. slug)
  if owner and owner ~= id then return {'SLUG'} end
end
local function str(v) if type(v) == 'string' then return v end return nil end
local oldSlug = old and str(old.slug) or nil
local oldFolder = old and str(old.folder) or nil
if slug ~= '' then redis.call('SET', prefix .. 'slug:' .. slug, id) end
if oldSlug and oldSlug ~= slug then
  if redis.call('GET', prefix .. 'slug:' .. oldSlug) == id then redis.call('DEL', prefix .. 'slug:' .. oldSlug) end
end
redis.call('ZADD', KEYS[2], score, id)
if oldFolder and oldFolder ~= folder then redis.call('SREM', prefix .. 'index:folder:' .. oldFolder, id) end
if folder ~= '' then redis.call('SADD', prefix .. 'index:folder:' .. folder, id) end
local keep = {}
for _, t in ipairs(newTags) do keep[t] = true end
if old and type(old.tags) == 'table' then
  for _, t in ipairs(old.tags) do
    if not keep[t] then
      local k = prefix .. 'index:tag:' .. t
      redis.call('SREM', k, id)
      if redis.call('SCARD', k) == 0 then redis.call('SREM', KEYS[3], t) end
    end
  end
end
for _, t in ipairs(newTags) do
  redis.call('SADD', prefix .. 'index:tag:' .. t, id)
  redis.call('SADD', KEYS[3], t)
end
redis.call('SET', KEYS[1], json)
return {'OK'}
`;

export const PURGE = `
local prefix, id = ARGV[1], ARGV[2]
local cur = redis.call('GET', KEYS[1])
if not cur then return 0 end
local old = cjson.decode(cur)
if ARGV[3] ~= "1" and old.status ~= "trashed" then return -1 end
if type(old.slug) == 'string' and redis.call('GET', prefix .. 'slug:' .. old.slug) == id then
  redis.call('DEL', prefix .. 'slug:' .. old.slug)
end
if type(old.folder) == 'string' then redis.call('SREM', prefix .. 'index:folder:' .. old.folder, id) end
if type(old.tags) == 'table' then
  for _, t in ipairs(old.tags) do
    local k = prefix .. 'index:tag:' .. t
    redis.call('SREM', k, id)
    if redis.call('SCARD', k) == 0 then redis.call('SREM', KEYS[3], t) end
  end
end
redis.call('ZREM', KEYS[2], id)
redis.call('DEL', KEYS[1], KEYS[4])
return 1
`;

export const RESOLVE = `
local id = redis.call('GET', KEYS[1])
if not id then return false end
local rec = redis.call('GET', ARGV[1] .. 'code:' .. id)
if not rec then return false end
local n = redis.call('GET', ARGV[1] .. 'count:' .. id)
local st = redis.call('GET', ARGV[1] .. 'settings')
return {rec, n or '0', st or ''}
`;

export const ACCEPT = `
if ARGV[9] ~= '' then
  local raw = redis.call('GET', KEYS[5])
  if not raw then return -2 end
  local rec = cjson.decode(raw)
  if tonumber(rec.rev) ~= tonumber(ARGV[9]) then return -2 end
  local now = tonumber(ARGV[10])
  if ARGV[11] ~= '' and now >= tonumber(ARGV[11]) then return -2 end
end
local limit = tonumber(ARGV[1])
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if limit > 0 and current >= limit then return -1 end
local track = ARGV[2] == '1'
if limit > 0 or track then current = redis.call('INCR', KEYS[1]) end
if track then
  local ttl = tonumber(ARGV[3])
  for i = 2, 3 do
    redis.call('HINCRBY', KEYS[i], 'n', 1)
    if ARGV[4] ~= '' then redis.call('HINCRBY', KEYS[i], 'd:' .. ARGV[4], 1) end
    if ARGV[5] ~= '' then redis.call('HINCRBY', KEYS[i], 'c:' .. ARGV[5], 1) end
    if i == 3 then redis.call('HINCRBY', KEYS[i], 'k:' .. ARGV[8], 1) end
    redis.call('EXPIRE', KEYS[i], ttl)
  end
  if ARGV[6] ~= '' then
    redis.call('LPUSH', KEYS[4], ARGV[6])
    redis.call('LTRIM', KEYS[4], 0, tonumber(ARGV[7]) - 1)
  end
end
return current
`;

export const HIT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return n
`;

#!/usr/bin/env node
/**
 * Seeds the clone through its public HTTP API (not by poking the database),
 * which doubles as an end-to-end check that every write endpoint works.
 *
 *   node scripts/seed.mjs [baseUrl]
 */
const BASE = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'demo1234';

const ACCOUNTS = [
  { name: 'Demo Author', username: 'demo', password: DEMO_PASSWORD },
  { name: 'Arena Dev', username: 'arena', password: DEMO_PASSWORD },
];

/** Demo scripts written for this clone (not copied from the upstream site). */
const SCRIPTS = [
  {
    author: 'demo',
    name: 'Hello Tick',
    description:
      'Minimal starting point: proves that the script is loaded into the friendly battle and that tick() is called every game tick.',
    code: `-- Hello Tick — minimal NB Scripting example
local ticks = 0

function tick()
    ticks = ticks + 1
    if ticks % 20 == 0 then
        log("tick " .. ticks .. " in " .. server.gameMode)
    end
end
`,
  },
  {
    author: 'demo',
    name: 'Damage Announcer',
    description:
      'Subscribes to takingDamageListeners on every character and announces large hits in the room chat.',
    code: `-- Damage Announcer
local function subscribe(character)
    local callback = createCallback("DamageEventListener", function(source, projectile, damage, data, origin)
        if damage >= 2000 then
            log(character.data.name .. " took " .. math.floor(damage) .. " damage")
        end
    end)
    character.takingDamageListeners:add(callback)
end

function tick()
    for i, character in server.objectManager:getCharacters() do
        if not character.__watched then
            character.__watched = true
            subscribe(character)
        end
    end
end
`,
  },
  {
    author: 'demo',
    name: 'Pin Box Spawner',
    description: 'Spawns a box obstacle at the map pin position. Useful for building small obstacle courses.',
    code: `-- Pin Box Spawner
local spawned = {}

function tick()
    for i, character in server.objectManager:getCharacters() do
        local pin = character.pin
        if pin and not spawned[character.index] then
            spawned[character.index] = true
            local data = lookup(18, "box")
            if data then
                local object = createObject(data)
                object.x = pin.x
                object.y = pin.y
                server.objectManager:addObject(object)
                log("box spawned at " .. pin.x .. ", " .. pin.y)
            end
        end
    end
end
`,
  },
  {
    author: 'arena',
    name: 'Everybody Random Trait',
    description: 'Gives every player a random trait every 3 seconds. Chaos mode — high crash risk, use with friends only.',
    code: `-- Everybody Random Trait
local elapsed = 0

function tick()
    elapsed = elapsed + 1
    if elapsed % 60 ~= 0 then return end

    for i, character in server.objectManager:getCharacters() do
        local trait = lookup(108, "random")
        if trait then
            createObject(trait)
            log("random trait for " .. character.data.name)
        end
    end
end
`,
  },
  {
    author: 'arena',
    name: 'Coin Rain',
    description: 'Coins spawn randomly around the map every second. Collect them to buy buffs.',
    code: `-- Coin Rain
local coins = 0

function tick()
    if server.tick % 20 ~= 0 then return end
    local data = lookup(18, "coin")
    if not data then return end
    local object = createObject(data)
    object.x = math.random(-800, 800)
    object.y = math.random(-800, 800)
    server.objectManager:addObject(object)
    coins = coins + 1
end
`,
  },
  {
    author: 'arena',
    name: 'Hide Everything',
    description: 'Nobody can see other players, projectiles or items — except objective objects such as the ball in Brawl Ball.',
    code: `-- Hide Everything
function tick()
    for i, character in server.objectManager:getCharacters() do
        character.visible = false
    end
    for i, projectile in server.objectManager:getProjectiles() do
        projectile.visible = false
    end
end
`,
  },
];

async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, setCookie: response.headers.get('set-cookie') };
}

function sessionCookie(response) {
  const raw = response.setCookie;
  if (!raw) return null;
  return raw.split(';')[0];
}

async function ensureAccount(account) {
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { username: account.username, password: account.password },
  });
  if (login.status === 200) return { ...login, created: false };

  const register = await request('/api/auth/register', {
    method: 'POST',
    body: account,
  });
  if (register.status === 201) return { ...register, created: true };
  throw new Error(`Could not create ${account.username}: ${register.status} ${JSON.stringify(register.data)}`);
}

async function main() {
  const health = await request('/api/health');
  if (health.status !== 200) {
    console.error(`API is not reachable at ${BASE} (status ${health.status}). Start it with \`npm run dev\`.`);
    process.exit(1);
  }

  const sessions = new Map();
  const users = new Map();

  for (const account of ACCOUNTS) {
    const result = await ensureAccount(account);
    const cookie = result.created ? sessionCookie(result) : sessionCookie(result);
    if (!cookie) throw new Error(`No session cookie for ${account.username}`);
    sessions.set(account.username, cookie);
    users.set(account.username, result.data.user);
    console.log(`${result.created ? 'created' : 'existing'} user @${account.username}`);
  }

  const existing = await request(`/api/users/${users.get('demo').user_id}/scripts`, {
    cookie: sessions.get('demo'),
  });
  if (existing.status === 200 && Array.isArray(existing.data?.scripts) && existing.data.scripts.length > 0) {
    console.log('Scripts already seeded — nothing to do.');
    report(users);
    return;
  }

  const created = [];
  for (const script of SCRIPTS) {
    const response = await request('/api/scripts', {
      method: 'POST',
      cookie: sessions.get(script.author),
      body: {
        name: script.name,
        description: script.description,
        code: script.code,
        publish: true,
      },
    });
    if (response.status !== 201) {
      throw new Error(`Failed to create "${script.name}": ${response.status} ${JSON.stringify(response.data)}`);
    }
    created.push(response.data);
    console.log(`created script "${script.name}" (${response.data.script_id})`);
  }

  // A couple of favorites so the profile page is not empty.
  await request(`/api/scripts/${created[1].script_id}/favorite`, {
    method: 'POST',
    cookie: sessions.get('arena'),
  });
  await request(`/api/scripts/${created[3].script_id}/favorite`, {
    method: 'POST',
    cookie: sessions.get('demo'),
  });

  report(users);
}

function report(users) {
  console.log('\nDemo accounts:');
  for (const account of ACCOUNTS) {
    console.log(`  ${account.username} / ${account.password}  (${BASE}/users/${users.get(account.username).user_id})`);
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});


const SUPABASE_URL = "https://vuknoitixjlrolmprzwo.supabase.co";
const SUPABASE_KEY = "sb_publishable_5duqz0ik84vZw55EP8fp6A_i3Ak3-Wh";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = id => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let selectedPerson = null;
let messageChannel = null;

let authMode = "login";

function show(id, visible) {
  const el = $(id);
  if (el) el.classList.toggle("hidden", !visible);
}

function notify(id, text) {
  const el = $(id);
  if (el) el.textContent = text;
}

function openApp() {
  show("auth-view", false);
  show("main-view", true);
  show("signout", true);

  notify(
    "welcome",
    "Welcome to VK CONNECT, " +
    (currentProfile?.display_name || "Member") + "!"
  );

  openSection("chats");
}

function closeApp() {
  show("main-view", false);
  show("auth-view", true);
  show("signout", false);
}

function openSection(name) {
  const sections = [
    "chats", "status", "calls",
    "communities", "discover", "profile"
  ];

  sections.forEach(section => {
    show("section-" + section, section === name);
  });

  if (name === "chats") loadPeople();
  if (name === "status") loadStatuses();
  if (name === "calls") loadCalls();
  if (name === "communities") loadCommunities();
  if (name === "discover") loadDiscover();
  if (name === "profile") loadProfile();
}

// LOGIN / SIGN UP MODE

function setAuthMode(mode) {
  authMode = mode;

  show("display-name", mode === "signup");

  $("auth-submit").textContent =
    mode === "signup" ? "Create Account" : "Login";

  notify("auth-message", "");
}

$("login-tab").addEventListener("click", () => {
  setAuthMode("login");
});

$("signup-tab").addEventListener("click", () => {
  setAuthMode("signup");
});

// LOAD USER PROFILE

async function loadProfile() {
  if (!currentUser) return;

  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const { data: created, error: createError } = await db
      .from("profiles")
      .insert({
        id: currentUser.id,
        display_name:
          currentUser.user_metadata?.display_name || "VK Member"
      })
      .select()
      .single();

    if (createError) throw createError;

    currentProfile = created;
  } else {
    currentProfile = data;
  }

  $("profile-name").value =
    currentProfile.display_name || "";

  $("profile-bio").value =
    currentProfile.bio || "";

  $("language").value =
    currentProfile.language || "en";
}

// REGISTER AND LOGIN

$("auth-form").addEventListener("submit", async event => {
  event.preventDefault();

  const email = $("email").value.trim();
  const password = $("password").value;
  const displayName = $("display-name").value.trim();

  notify("auth-message", "Connecting...");

  try {
    let result;

    if (authMode === "signup") {
      if (!displayName) {
        throw new Error("Enter your display name.");
      }

      result = await db.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName }
        }
      });
    } else {
      result = await db.auth.signInWithPassword({
        email,
        password
      });
    }

    if (result.error) throw result.error;

    if (result.data.session) {
      currentUser = result.data.user;
      await loadProfile();
      openApp();
    } else {
      notify(
        "auth-message",
        "Account created. Check your email if verification is required."
      );
    }
  } catch (error) {
    notify("auth-message", error.message);
  }
});

// SAVE PROFILE

$("profile-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentUser) return;

  try {
    const { error } = await db
      .from("profiles")
      .update({
        display_name: $("profile-name").value.trim(),
        bio: $("profile-bio").value.trim(),
        language: $("language").value
      })
      .eq("id", currentUser.id);

    if (error) throw error;

    await loadProfile();

    notify("profile-message", "Profile saved successfully!");
  } catch (error) {
    notify("profile-message", error.message);
  }
});

// FIND OTHER MEMBERS

async function loadPeople() {
  if (!currentUser) return;

  const list = $("people-list");
  list.textContent = "Loading members...";

  try {
    const { data, error } = await db
      .from("profiles")
      .select("id, display_name, bio")
      .neq("id", currentUser.id)
      .order("display_name");

    if (error) throw error;

    list.innerHTML = "";

    if (!data || data.length === 0) {
      list.textContent =
        "No other members yet. Invite friends to VK CONNECT!";
      return;
    }

    data.forEach(person => {
      const button = document.createElement("button");

      button.textContent =
        person.display_name || "VK Member";

      button.addEventListener("click", () => {
        selectPerson(person);
      });

      list.appendChild(button);
    });
  } catch (error) {
    list.textContent = "Could not load members: " + error.message;
  }
}

// DISCOVER MEMBERS

async function loadDiscover() {
  if (!currentUser) return;

  const list = $("discover-list");
  list.textContent = "Finding members...";

  try {
    const { data, error } = await db
      .from("profiles")
      .select("id, display_name, bio")
      .neq("id", currentUser.id)
      .order("display_name");

    if (error) throw error;

    list.innerHTML = "";

    if (!data.length) {
      list.textContent = "No members to discover yet.";
      return;
    }

    data.forEach(person => {
      const button = document.createElement("button");

      button.textContent =
        (person.display_name || "VK Member") +
        (person.bio ? " — " + person.bio : "");

      button.addEventListener("click", () => {
        openSection("chats");
        selectPerson(person);
      });

      list.appendChild(button);
    });
  } catch (error) {
    list.textContent = error.message;
  }
}

// OPEN A CHAT

async function selectPerson(person) {
  selectedPerson = person;

  $("chat-title").textContent =
    "Chat with " + (person.display_name || "VK Member");

  await loadMessages();
  subscribeToMessages();
}

// LOAD CHAT MESSAGES

async function loadMessages() {
  if (!selectedPerson || !currentUser) return;

  const list = $("messages");
  list.textContent = "Loading messages...";

  const { data, error } = await db
    .from("messages")
    .select("*")
    .or(
      `and(sender_id.eq.${currentUser.id},receiver_id.eq.${selectedPerson.id}),and(sender_id.eq.${selectedPerson.id},receiver_id.eq.${currentUser.id})`
    )
    .order("created_at");

  if (error) {
    list.textContent = error.message;
    return;
  }

  list.innerHTML = "";

  if (!data.length) {
    list.textContent = "Start your conversation!";
    return;
  }

  data.forEach(item => {
    const div = document.createElement("div");

    div.style.padding = "10px";
    div.style.margin = "7px";
    div.style.borderRadius = "9px";
    div.style.background =
      item.sender_id === currentUser.id
        ? "#dceaff" : "#eeeeee";

    div.textContent =
      (item.sender_id === currentUser.id ? "You: " : "Them: ") +
      (item.body || "Media message");

    list.appendChild(div);
  });

  list.scrollTop = list.scrollHeight;
}

// SEND MESSAGE

$("message-form").addEventListener("submit", async event => {
  event.preventDefault();

  if (!selectedPerson) {
    alert("Select a member first.");
    return;
  }

  const body = $("message-input").value.trim();
  if (!body) return;

  const { error } = await db.from("messages").insert({
    sender_id: currentUser.id,
    receiver_id: selectedPerson.id,
    body
  });

  if (error) {
    alert(error.message);
    return;
  }

  $("message-input").value = "";
  await loadMessages();
});

// REALTIME CHAT

function subscribeToMessages() {
  if (messageChannel) {
    db.removeChannel(messageChannel);
  }

  messageChannel = db
    .channel("vk-chat-" + currentUser.id)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages"
      },
      () => loadMessages()
    )
    .subscribe();
}

// POST STATUS

$("status-form").addEventListener("submit", async event => {
  event.preventDefault();

  const body = $("status-input").value.trim();
  if (!body || !currentUser) return;

  const { error } = await db.from("statuses").insert({
    user_id: currentUser.id,
    body
  });

  if (error) {
    alert(error.message);
    return;
  }

  $("status-input").value = "";
  loadStatuses();
});

// LOAD STATUS

async function loadStatuses() {
  const list = $("status-list");
  list.textContent = "Loading statuses...";

  const { data, error } = await db
    .from("statuses")
    .select("*, profiles(display_name)")
    .order("created_at", { ascending: false });

  if (error) {
    list.textContent = error.message;
    return;
  }

  list.innerHTML = "";

  if (!data.length) {
    list.textContent = "No status updates yet.";
    return;
  }

  data.forEach(status => {
    const div = document.createElement("div");
    div.textContent =
      (status.profiles?.display_name || "VK Member") +
      ": " + status.body;

    list.appendChild(div);
  });
}

// CREATE COMMUNITY

$("community-form").addEventListener("submit", async event => {
  event.preventDefault();

  const name = $("community-name").value.trim();
  if (!name || !currentUser) return;

  const { data, error } = await db
    .from("communities")
    .insert({
      name,
      created_by: currentUser.id
    })
    .select()
    .single();

  if (error) {
    alert(error.message);
    return;
  }

  await db.from("community_members").insert({
    community_id: data.id,
    user_id: currentUser.id
  });

  $("community-name").value = "";
  loadCommunities();
});

// LOAD COMMUNITIES

async function loadCommunities() {
  const list = $("community-list");
  list.textContent = "Loading communities...";

  const { data, error } = await db
    .from("communities")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    list.textContent = error.message;
    return;
  }

  list.innerHTML = "";

  if (!data.length) {
    list.textContent = "No communities yet.";
    return;
  }

  data.forEach(community => {
    const div = document.createElement("div");
    div.textContent = community.name;
    list.appendChild(div);
  });
}

// CALL HISTORY

async function loadCalls() {
  const list = $("calls-list");

  const { data, error } = await db
    .from("call_events")
    .select("*")
    .or(
      `caller_id.eq.${currentUser.id},callee_id.eq.${currentUser.id}`
    )
    .order("created_at", { ascending: false });

  if (error) {
    list.textContent = error.message;
    return;
  }

  list.innerHTML = "";

  if (!data.length) {
    list.textContent = "No calls yet.";
    return;
  }

  data.forEach(call => {
    const div = document.createElement("div");
    div.textContent =
      call.call_type + " call — " + call.status;
    list.appendChild(div);
  });
}

// NAVIGATION BUTTONS

document.querySelectorAll("[data-section]").forEach(button => {
  button.addEventListener("click", () => {
    openSection(button.dataset.section);
  });
});

// SIGN OUT

$("signout").addEventListener("click", async () => {
  if (messageChannel) {
    await db.removeChannel(messageChannel);
    messageChannel = null;
  }

  await db.auth.signOut();

  currentUser = null;
  currentProfile = null;
  selectedPerson = null;

  closeApp();
});

// RESTORE LOGIN SESSION

async function startApp() {
  try {
    const { data, error } = await db.auth.getSession();

    if (error) throw error;

    if (data.session) {
      currentUser = data.session.user;
      await loadProfile();
      openApp();
    } else {
      closeApp();
    }
  } catch (error) {
    closeApp();
    notify("auth-message", "App error: " + error.message);
  }
}

db.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT") {
    currentUser = null;
    currentProfile = null;
    closeApp();
  }
});

setAuthMode("login");
startApp();

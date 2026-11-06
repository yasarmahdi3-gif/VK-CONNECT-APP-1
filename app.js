
const SUPABASE_URL = "https://vuknoitixjlrolmprzwo.supabase.co";
const SUPABASE_KEY = "sb_publishable_5duqz0ik84vZw55EP8fp6A_i3Ak3-Wh";

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let selectedPerson = null;
let messageSubscription = null;
let authMode = "login";

function show(id, visible) {
  const element = $(id);
  if (element) element.classList.toggle("hidden", !visible);
}

function message(id, text) {
  if ($(id)) $(id).textContent = text;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function openSection(name) {
  const sections = [
    "chats",
    "status",
    "calls",
    "communities",
    "discover",
    "profile"
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

function openApp() {
  show("auth-view", false);
  show("main-view", true);
  show("signout", true);

  message(
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

function setAuthMode(mode) {
  authMode = mode;

  show("display-name", mode === "signup");

  $("auth-submit").textContent =
    mode === "signup" ? "Create Account" : "Login";

  message("auth-message", "");
}

$("login-tab").addEventListener("click", () => {
  setAuthMode("login");
});

$("signup-tab").addEventListener("click", () => {
  setAuthMode("signup");
});

// REGISTER AND LOGIN
$("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("email").value.trim();
  const password = $("password").value;
  const displayName = $("display-name").value.trim();

  message("auth-message", "Please wait...");

  try {
    let result;

    if (authMode === "signup") {
      if (!displayName) {
        throw new Error("Please enter your display name.");
      }

      result = await db.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName }
        }
      });

      if (result.error) throw result.error;

      if (result.data.session) {
        currentUser = result.data.user;
        await loadProfile();
        openApp();
      } else {
        message(
          "auth-message",
          "Account created. Check your email if verification is required."
        );
      }
    } else {
      result = await db.auth.signInWithPassword({
        email,
        password
      });

      if (result.error) throw result.error;

      currentUser = result.data.user;
      await loadProfile();
      openApp();
    }
  } catch (error) {
    message("auth-message", error.message);
  }
});

// LOAD PROFILE
async function loadProfile() {
  if (!currentUser) return;

  let { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) throw error;

  if (!data) {
    const result = await db
      .from("profiles")
      .insert({
        id: currentUser.id,
        display_name:
          currentUser.user_metadata?.display_name || "VK member"
      })
      .select()
      .single();

    if (result.error) throw result.error;
    data = result.data;
  }

  currentProfile = data;

  $("profile-name").value = data.display_name || "";
  $("profile-bio").value = data.bio || "";
  $("language").value = data.language || "en";
}

// SAVE PROFILE
$("profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) return;

  const { error } = await db
    .from("profiles")
    .update({
      display_name: $("profile-name").value.trim(),
      bio: $("profile-bio").value.trim(),
      language: $("language").value
    })
    .eq("id", currentUser.id);

  if (error) {
    message("profile-message", error.message);
    return;
  }

  await loadProfile();

  message("profile-message", "Profile saved successfully!");
  message(
    "welcome",
    "Welcome to VK CONNECT, " + currentProfile.display_name + "!"
  );
});

// LOAD PEOPLE
async function loadPeople() {
  if (!currentUser) return;

  const { data, error } = await db
    .from("profiles")
    .select("id, display_name, bio")
    .neq("id", currentUser.id)
    .order("display_name");

  if (error) {
    $("people-list").textContent = error.message;
    return;
  }

  $("people-list").innerHTML = "";

  if (!data.length) {
    $("people-list").textContent =
      "No other members yet. Invite a friend to join VK CONNECT!";
    return;
  }

  data.forEach(person => {
    const button = document.createElement("button");
    button.textContent = person.display_name || "VK member";
    button.addEventListener("click", () => selectPerson(person));
    $("people-list").appendChild(button);
  });
}

// LOAD DISCOVER
async function loadDiscover() {
  if (!currentUser) return;

  const { data, error } = await db
    .from("profiles")
    .select("id, display_name, bio")
    .neq("id", currentUser.id)
    .order("display_name");

  if (error) {
    $("discover-list").textContent = error.message;
    return;
  }

  $("discover-list").innerHTML = "";

  if (!data.length) {
    $("discover-list").textContent = "No members to discover yet.";
    return;
  }

  data.forEach(person => {
    const button = document.createElement("button");
    button.textContent =
      (person.display_name || "VK member") +
      (person.bio ? " — " + person.bio : "");

    button.addEventListener("click", () => {
      openSection("chats");
      selectPerson(person);
    });

    $("discover-list").appendChild(button);
  });
}

// SELECT A CHAT
async function selectPerson(person) {
  selectedPerson = person;

  $("chat-title").textContent =
    "Chat with " + (person.display_name || "VK member");

  await loadMessages();
  subscribeToMessages();
}

// LOAD MESSAGES
async function loadMessages() {
  if (!selectedPerson || !currentUser) return;

  const { data, error } = await db
    .from("messages")
    .select("*")
    .or(
      `and(sender_id.eq.${currentUser.id},receiver_id.eq.${selectedPerson.id}),and(sender_id.eq.${selectedPerson.id},receiver_id.eq.${currentUser.id})`
    )
    .order("created_at");

  if (error) {
    $("messages").textContent = error.message;
    return;
  }

  $("messages").innerHTML = "";

  if (!data.length) {
    $("messages").textContent = "Start your conversation!";
    return;
  }

  data.forEach(appendMessage);
}

function appendMessage(item) {
  const div = document.createElement("div");

  div.style.padding = "9px";
  div.style.margin = "7px";
  div.style.borderRadius = "9px";
  div.style.background =
    item.sender_id === currentUser.id ? "#dceaff" : "#eeeeee";

  div.textContent =
    (item.sender_id === currentUser.id ? "You: " : "Them: ") +
    (item.body || "Media message");

  $("messages").appendChild(div);
  $("messages").scrollTop = $("messages").scrollHeight;
}

// SEND MESSAGE
$("message-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!selectedPerson) {
    alert("Select a person first.");
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

// REALTIME MESSAGES
function subscribeToMessages() {
  if (messageSubscription) {
    db.removeChannel(messageSubscription);
  }

  if (!selectedPerson) return;

  messageSubscription = db
    .channel("vk-chat-" + currentUser.id)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages"
      },
      payload => {
        const item = payload.new;

        if (
          (item.sender_id === currentUser.id &&
            item.receiver_id === selectedPerson.id) ||
          (item.sender_id === selectedPerson.id &&
            item.receiver_id === currentUser.id)
        ) {
          loadMessages();
        }
      }
    )
    .subscribe();
}

// CREATE STATUS
$("status-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const body = $("status-input").value.trim();
  if (!body) return;

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

// LOAD STATUSES
async function loadStatuses() {
  const { data, error } = await db
    .from("statuses")
    .select("*, profiles(display_name)")
    .order("created_at", { ascending: false });

  if (error) {
    $("status-list").textContent = error.message;
    return;
  }

  $("status-list").innerHTML = "";

  if (!data.length) {
    $("status-list").textContent = "No status updates yet.";
    return;
  }

  data.forEach(status => {
    const div = document.createElement("div");
    div.textContent =
      (status.profiles?.display_name || "VK member") +
      ": " + status.body;
    $("status-list").appendChild(div);
  });
}

// CREATE COMMUNITY
$("community-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = $("community-name").value.trim();
  if (!name) return;

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
  const { data, error } = await db
    .from("communities")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    $("community-list").textContent = error.message;
    return;
  }

  $("community-list").innerHTML = "";

  if (!data.length) {
    $("community-list").textContent = "No communities yet.";
    return;
  }

  data.forEach(community => {
    const div = document.createElement("div");
    div.textContent = community.name;
    $("community-list").appendChild(div);
  });
}

// CALL HISTORY
async function loadCalls() {
  const { data, error } = await db
    .from("call_events")
    .select("*")
    .or(
      `caller_id.eq.${currentUser.id},callee_id.eq.${currentUser.id}`
    )
    .order("created_at", { ascending: false });

  if (error) {
    $("calls-list").textContent = error.message;
    return;
  }

  $("calls-list").innerHTML = "";

  if (!data.length) {
    $("calls-list").textContent =
      "No calls yet. Voice and video calling will be added separately.";
    return;
  }

  data.forEach(call => {
    const div = document.createElement("div");
    div.textContent =
      call.call_type + " call — " + call.status;
    $("calls-list").appendChild(div);
  });
}

// MEDIA UPLOAD
$("upload-btn").addEventListener("click", async () => {
  const file = $("media-file").files[0];

  if (!file || !selectedPerson) {
    alert("Choose a file and select a chat first.");
    return;
  }

  const path =
    currentUser.id + "/" + Date.now() + "_" + file.name;

  const { error } = await db.storage
    .from("chat-media")
    .upload(path, file);

  if (error) {
    alert(error.message);
    return;
  }

  const { data } = db.storage
    .from("chat-media")
    .getPublicUrl(path);

  const { error: messageError } = await db
    .from("messages")
    .insert({
      sender_id: currentUser.id,
      receiver_id: selectedPerson.id,
      body: "",
      media_url: data.publicUrl
    });

  if (messageError) {
    alert(messageError.message);
    return;
  }

  alert("Media uploaded successfully!");
  await loadMessages();
});

// NAVIGATION
document.querySelectorAll("[data-section]").forEach(button => {
  button.addEventListener("click", () => {
    openSection(button.dataset.section);
  });
});

// SIGN OUT
$("signout").addEventListener("click", async () => {
  if (messageSubscription) {
    await db.removeChannel(messageSubscription);
    messageSubscription = null;
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
    console.error("VK CONNECT startup error:", error);
    closeApp();
    message("auth-message", "App error: " + error.message);
  }
}

db.auth.onAuthStateChange((event, session) => {
  if (event === "SIGNED_OUT") {
    currentUser = null;
    closeApp();
  }
});

setAuthMode("login");
startApp();

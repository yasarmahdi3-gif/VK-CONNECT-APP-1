
const SUPABASE_URL = "https://vuknoitixjlrolmprzwo.supabase.co";

const SUPABASE_KEY = "sb_publishable_5duqz0ik84vZw55EP8fp6A_i3Ak3-Wh";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

let currentUser = null;
let activeChatUser = null;
let messageChannel = null;
let authMode = "login";

const $ = id => document.getElementById(id);

function show(id, visible = true) {
  $(id).classList.toggle("hidden", !visible);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

function time(value) {
  return new Date(value).toLocaleString();
}

// AUTHENTICATION

function setAuthMode(mode) {
  authMode = mode;

  $("login-tab").classList.toggle("active", mode === "login");
  $("signup-tab").classList.toggle("active", mode === "signup");

  show("display-name", mode === "signup");

  $("auth-submit").textContent =
    mode === "login" ? "Sign in" : "Create account";
}

$("login-tab").onclick = () => setAuthMode("login");
$("signup-tab").onclick = () => setAuthMode("signup");

$("auth-form").onsubmit = async e => {
  e.preventDefault();

  $("auth-message").textContent = "Please wait...";

  const email = $("email").value.trim();
  const password = $("password").value;

  let result;

  if (authMode === "signup") {
    result = await db.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: $("display-name").value.trim()
        }
      }
    });

    if (!result.error && !result.data.session) {
      $("auth-message").textContent =
        "Account created! Check your email to confirm your account.";
      return;
    }
  } else {
    result = await db.auth.signInWithPassword({
      email,
      password
    });
  }

  if (result.error) {
    $("auth-message").textContent = result.error.message;
    return;
  }

  if (result.data.session) {
    await loadApp(result.data.session.user);
  }
};

// SIGN OUT

$("signout").onclick = async () => {
  await db.auth.signOut();
  location.reload();
};

// LOAD APPLICATION

async function loadApp(user) {
  currentUser = user;

  show("auth-view", false);
  show("main-view");
  show("signout");

  const { data, error } = await db
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    alert(error.message);
    return;
  }

  $("welcome").textContent =
    "Welcome, " + (data?.display_name || user.email);

  $("profile-name").value = data?.display_name || "";
  $("profile-bio").value = data?.bio || "";
  $("language").value = data?.language || "en";

  await Promise.all([
    loadPeople(),
    loadStatuses(),
    loadCommunities(),
    loadCalls()
  ]);
}

// PEOPLE AND DISCOVERY

async function loadPeople() {
  const { data, error } = await db
    .from("profiles")
    .select("id,display_name,bio")
    .neq("id", currentUser.id)
    .order("display_name");

  if (error) {
    $("people-list").textContent = error.message;
    return;
  }

  $("people-list").innerHTML = "";

  if (!data.length) {
    $("people-list").textContent =
      "No other members yet. Invite friends to join!";
  }

  data.forEach(person => {
    const button = document.createElement("button");

    button.innerHTML =
      `<strong>${escapeHTML(person.display_name)}</strong>
       <small>${escapeHTML(person.bio)}</small>`;

    button.onclick = () => openChat(person);

    $("people-list").appendChild(button);
  });

  $("discover-list").innerHTML =
    $("people-list").innerHTML;

  [...$("discover-list").querySelectorAll("button")]
    .forEach((button, index) => {
      button.onclick = () => openChat(data[index]);
    });
}

async function openChat(person) {
  activeChatUser = person;

  $("chat-title").textContent =
    person.display_name || "Private chat";

  $("message-input").disabled = false;
  $("message-form").querySelector("button").disabled = false;

  $("media-file").disabled = false;
  $("upload-btn").disabled = false;

  await loadMessages();

  if (messageChannel) {
    await db.removeChannel(messageChannel);
  }

  messageChannel = db
    .channel("chat-" + [currentUser.id, person.id].sort().join("-"))
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "messages"
      },
      payload => {
        const m = payload.new;

        if (
          (m.sender_id === currentUser.id &&
           m.receiver_id === person.id) ||
          (m.sender_id === person.id &&
           m.receiver_id === currentUser.id)
        ) {
          appendMessage(m);
        }
      }
    )
    .subscribe();
}

// MESSAGES

function appendMessage(message) {
  const box = $("messages");

  if (box.querySelector(".muted")) {
    box.innerHTML = "";
  }

  if (box.querySelector(`[data-id="${message.id}"]`)) {
    return;
  }

  const div = document.createElement("div");

  div.className =
    "bubble" +
    (message.sender_id === currentUser.id ? " mine" : "");

  div.dataset.id = message.id;

  const content = message.media_url
    ? `<a href="${escapeHTML(message.media_url)}" target="_blank">Open media</a>`
    : escapeHTML(message.body);

  div.innerHTML =
    `${content}<small>${time(message.created_at)}</small>`;

  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

async function loadMessages() {
  $("messages").innerHTML = "Loading messages...";

  const { data, error } = await db
    .from("messages")
    .select("*")
    .or(
      `and(sender_id.eq.${currentUser.id},receiver_id.eq.${activeChatUser.id}),and(sender_id.eq.${activeChatUser.id},receiver_id.eq.${currentUser.id})`
    )
    .order("created_at");

  if (error) {
    $("messages").textContent = error.message;
    return;
  }

  $("messages").innerHTML = "";

  if (!data.length) {
    $("messages").textContent = "Say hello!";
  }

  data.forEach(appendMessage);
}

$("message-form").onsubmit = async e => {
  e.preventDefault();

  if (!activeChatUser) return;

  const body = $("message-input").value.trim();

  if (!body) return;

  const { error } = await db.from("messages").insert({
    sender_id: currentUser.id,
    receiver_id: activeChatUser.id,
    body
  });

  if (error) {
    alert(error.message);
    return;
  }

  $("message-input").value = "";
};

// MEDIA UPLOAD

$("upload-btn").onclick = async () => {
  const file = $("media-file").files[0];

  if (!file || !activeChatUser) return;

  if (file.size > 20 * 1024 * 1024) {
    alert("Maximum file size is 20 MB.");
    return;
  }

  const path =
    currentUser.id + "/" + Date.now() + "-" +
    file.name.replace(/[^a-zA-Z0-9._-]/g, "_");

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
      receiver_id: activeChatUser.id,
      body: "",
      media_url: data.publicUrl
    });

  if (messageError) {
    alert(messageError.message);
  } else {
    $("media-file").value = "";
  }
};

// STATUS

$("status-form").onsubmit = async e => {
  e.preventDefault();

  const body = $("status-input").value.trim();

  if (!body) return;

  const { error } = await db
    .from("statuses")
    .insert({
      user_id: currentUser.id,
      body
    });

  if (error) {
    alert(error.message);
    return;
  }

  $("status-input").value = "";
  loadStatuses();
};

async function loadStatuses() {
  const { data, error } = await db
    .from("statuses")
    .select("id,body,created_at,user_id,profiles(display_name)")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    $("status-list").textContent = error.message;
    return;
  }

  $("status-list").innerHTML = data.map(s => `
    <div class="bubble">
      <strong>${escapeHTML(s.profiles?.display_name || "VK member")}</strong>
      <p>${escapeHTML(s.body)}</p>
      <small>${time(s.created_at)}</small>
    </div>
  `).join("");
}

// COMMUNITIES

$("community-form").onsubmit = async e => {
  e.preventDefault();

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

  const joined = await db
    .from("community_members")
    .insert({
      community_id: data.id,
      user_id: currentUser.id
    });

  if (joined.error) {
    alert(joined.error.message);
    return;
  }

  $("community-name").value = "";
  loadCommunities();
};

async function loadCommunities() {
  const { data, error } = await db
    .from("communities")
    .select("id,name,created_at,profiles:created_by(display_name)")
    .order("created_at", { ascending: false });

  if (error) {
    $("community-list").textContent = error.message;
    return;
  }

  $("community-list").innerHTML = data.map(c => `
    <div class="bubble">
      <strong>${escapeHTML(c.name)}</strong>
      <small>Created by ${escapeHTML(c.profiles?.display_name || "VK member")}</small>
      <button class="join-community" data-id="${c.id}">Join</button>
    </div>
  `).join("");

  document.querySelectorAll(".join-community").forEach(button => {
    button.onclick = async () => {
      const { error } = await db
        .from("community_members")
        .insert({
          community_id: button.dataset.id,
          user_id: currentUser.id
        });

      alert(error ? error.message : "You joined the community!");
    };
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

  $("calls-list").innerHTML = data.map(c => `
    <div class="bubble">
      ${escapeHTML(c.call_type)} call · ${escapeHTML(c.status)}
      <small>${time(c.created_at)}</small>
    </div>
  `).join("");
}

// PROFILE

$("profile-form").onsubmit = async e => {
  e.preventDefault();

  const patch = {
    display_name: $("profile-name").value.trim(),
    bio: $("profile-bio").value.trim(),
    language: $("language").value
  };

  const { error } = await db
    .from("profiles")
    .update(patch)
    .eq("id", currentUser.id);

  $("profile-message").textContent =
    error ? error.message : "Profile saved successfully!";
};

// NAVIGATION

document.querySelectorAll(".navigation button")
.forEach(button => {
  button.onclick = () => {
    document.querySelectorAll(".navigation button")
      .forEach(b => b.classList.toggle("active", b === button));

    [
      "chats",
      "status",
      "calls",
      "communities",
      "discover",
      "profile"
    ].forEach(section => {
      show(
        "section-" + section,
        section === button.dataset.section
      );
    });
  };
});

// AUTOMATIC LOGIN RESTORE

(async () => {
  const { data, error } = await db.auth.getSession();

  if (error) {
    console.error(error.message);
    return;
  }

  if (data.session) {
    await loadApp(data.session.user);
  }
})();

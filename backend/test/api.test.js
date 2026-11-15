import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import {
  buildActivityFeed,
  buildFriendActivityFilter,
  buildRecentFilter,
  buildSearchCondition,
  buildTrackFilter,
  canAccessTrack,
  createApp,
  escapeRegex,
  isAcceptedUpload,
  MAX_COVER_SIZE,
  MAX_SEARCH_LENGTH,
  parsePublicFlag,
  parseTrackUpdate,
  toTrackResponse,
} from "../src/app.js";
import { User } from "../src/models/User.js";
import { Track } from "../src/models/Track.js";
import { Friendship } from "../src/models/Friendship.js";

let server, base;

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server.close());

test("health sans dépendre de MongoDB", async () => {
  const r = await fetch(base + "/api/health");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).status, "ok");
});

test("schémas Mongoose et relation", () => {
  const u = new User({
    name: "Test",
    email: "TEST@example.com",
    password: "12345678",
  });

  assert.equal(u.email, "test@example.com");
  const t = new Track({
    ownerId: new mongoose.Types.ObjectId(),
    title: "Blues",
    originalName: "b.mp3",
    storedName: "x.mp3",
    mimeType: "audio/mpeg",
    size: 42,
  });
  
  assert.equal(t.title, "Blues");
  assert.equal(t.isPublic, false);
  assert.equal(t.toPublic().isPublic, false);
  assert.equal(Track.schema.path("ownerId").options.ref, "User");
  assert.equal(Track.schema.path("isPublic").options.default, false);
  assert.equal(Track.schema.path("visibility").options.default, "private");
  const friendship = new Friendship({
    requesterId: new mongoose.Types.ObjectId(),
    addresseeId: new mongoose.Types.ObjectId(),
  });
  assert.equal(friendship.status, "pending");
});

test("normalise les valeurs de visibilité publique et échappe les recherches", () => {
  assert.equal(parsePublicFlag(true), true);
  assert.equal(parsePublicFlag("true"), true);
  assert.equal(parsePublicFlag("on"), true);
  assert.equal(parsePublicFlag("false"), false);
  assert.equal(parsePublicFlag(undefined), false);
  assert.equal(escapeRegex("alice.*"), "alice\\.\\*");
});

test("les données publiques utilisateur n'exposent pas le hash", () => {
  const user = new User({
    name: "Alice",
    email: "alice@example.com",
    password: "12345678",
  });
  const publicUser = user.toPublic();
  assert.deepEqual(Object.keys(publicUser).sort(), ["createdAt", "email", "id", "name"]);
  assert.equal("passwordHash" in publicUser, false);
});

test("route protégée sans JWT répond 401", async () => {
  const response = await fetch(base + "/api/tracks");
  assert.equal(response.status, 401);
});

test("route protégée avec un JWT invalide répond 401", async () => {
  const response = await fetch(base + "/api/tracks", {
    headers: { Authorization: "Bearer invalid-test-token" },
  });
  assert.equal(response.status, 401);
});

// --- Mission TP4-1 : recherche de fichiers et récemment ajoutés ---

test("la recherche vide ne produit aucun filtre texte", () => {
  assert.equal(buildSearchCondition(""), null);
  assert.equal(buildSearchCondition("   "), null);
  assert.equal(buildSearchCondition(undefined), null);
});

test("la recherche porte sur le titre et le nom, insensible à la casse et échappée", () => {
  const condition = buildSearchCondition("  blues.*  ");
  assert.deepEqual(condition, {
    $or: [
      { title: { $regex: "blues\\.\\*", $options: "i" } },
      { originalName: { $regex: "blues\\.\\*", $options: "i" } },
    ],
  });
});

test("la recherche est tronquée à la longueur maximale", () => {
  const condition = buildSearchCondition("a".repeat(200));
  assert.equal(condition.$or[0].title.$regex.length, MAX_SEARCH_LENGTH);
});

test("buildTrackFilter respecte chaque portée", () => {
  const userId = "user-1";
  const friendIds = ["friend-1"];
  assert.deepEqual(buildTrackFilter({ userId }), { ownerId: userId });
  assert.deepEqual(buildTrackFilter({ scope: "public", userId }), {
    $or: [{ visibility: "public" }, { isPublic: true }],
  });
  assert.deepEqual(buildTrackFilter({ scope: "friends", userId, friendIds }), {
    ownerId: { $in: friendIds },
    $or: [{ visibility: "friends" }, { sharedWith: userId }],
  });
});

test("buildTrackFilter combine portée et recherche avec $and", () => {
  const filter = buildTrackFilter({ scope: "public", userId: "u", q: "jazz" });
  assert.equal(filter.$and.length, 2);
  assert.deepEqual(filter.$and[0], { $or: [{ visibility: "public" }, { isPublic: true }] });
  assert.equal(filter.$and[1].$or[0].title.$regex, "jazz");
});

test("les récents excluent l'utilisateur et incluent public et amis", () => {
  const filter = buildRecentFilter("me", ["f1"]);
  assert.deepEqual(filter.ownerId, { $ne: "me" });
  assert.deepEqual(filter.$or, [
    { visibility: "public" },
    { isPublic: true },
    { ownerId: { $in: ["f1"] }, visibility: "friends" },
    { ownerId: { $in: ["f1"] }, sharedWith: "me" },
  ]);
});

test("toTrackResponse expose le nom du propriétaire sans _id ni storedName", () => {
  const ownerId = new mongoose.Types.ObjectId();
  const trackId = new mongoose.Types.ObjectId();
  const response = toTrackResponse({
    _id: trackId,
    ownerId: { _id: ownerId, name: "Alice" },
    title: "Blues",
    originalName: "b.mp3",
    storedName: "secret.mp3",
    mimeType: "audio/mpeg",
    size: 42,
    visibility: "public",
    isPublic: false,
    createdAt: new Date("2026-01-01"),
  });
  assert.equal(response.id, String(trackId));
  assert.equal(response.ownerId, String(ownerId));
  assert.equal(response.ownerName, "Alice");
  assert.equal(response.isPublic, true);
  assert.equal("_id" in response, false);
  assert.equal("storedName" in response, false);
});

test("toTrackResponse gère un propriétaire non peuplé et une ancienne piste", () => {
  const ownerId = new mongoose.Types.ObjectId();
  const response = toTrackResponse({
    _id: new mongoose.Types.ObjectId(),
    ownerId,
    title: "Ancienne",
    originalName: "old.mp3",
    mimeType: "audio/mpeg",
    size: 1,
    isPublic: true,
  });
  assert.equal(response.ownerId, String(ownerId));
  assert.equal(response.ownerName, null);
  assert.equal(response.visibility, "public");
});

test("les pistes récentes exigent un JWT", async () => {
  const response = await fetch(base + "/api/tracks/recent");
  assert.equal(response.status, 401);
});

// --- Mission TP4-2 : partage piste par piste ---

const ownerOid = new mongoose.Types.ObjectId();
const friendOid = new mongoose.Types.ObjectId();
const strangerOid = new mongoose.Types.ObjectId();

function privateTrack(extra = {}) {
  return { ownerId: ownerOid, visibility: "private", isPublic: false, sharedWith: [], ...extra };
}

test("le propriétaire accède toujours à sa piste", () => {
  assert.equal(canAccessTrack(privateTrack(), String(ownerOid), false), true);
});

test("une piste publique est accessible à tous, même sans amitié", () => {
  assert.equal(canAccessTrack(privateTrack({ visibility: "public" }), strangerOid, false), true);
  assert.equal(canAccessTrack(privateTrack({ isPublic: true }), strangerOid, false), true);
});

test("une piste privée non partagée est refusée, même à un ami", () => {
  assert.equal(canAccessTrack(privateTrack(), friendOid, true), false);
  assert.equal(canAccessTrack(null, friendOid, true), false);
});

test("une piste « amis » est accessible aux seuls amis", () => {
  const track = privateTrack({ visibility: "friends" });
  assert.equal(canAccessTrack(track, friendOid, true), true);
  assert.equal(canAccessTrack(track, strangerOid, false), false);
});

test("le partage ciblé exige d'être dans sharedWith et encore ami", () => {
  const track = privateTrack({ sharedWith: [friendOid] });
  assert.equal(canAccessTrack(track, String(friendOid), true), true);
  // Ami retiré : la présence résiduelle dans sharedWith ne suffit pas.
  assert.equal(canAccessTrack(track, String(friendOid), false), false);
  // Un autre ami non sélectionné n'y a pas accès.
  assert.equal(canAccessTrack(track, String(strangerOid), true), false);
});

test("parseTrackUpdate accepte titre, visibilité et partage nettoyés", () => {
  const id = String(friendOid);
  const result = parseTrackUpdate({ title: "  Solo  ", visibility: "private", sharedWith: [id, id] });
  assert.deepEqual(result, { changes: { title: "Solo", visibility: "private", sharedWith: [id] } });
});

test("parseTrackUpdate ignore les champs non autorisés", () => {
  const result = parseTrackUpdate({ title: "Ok", ownerId: String(strangerOid), storedName: "x" });
  assert.deepEqual(result, { changes: { title: "Ok" } });
});

test("parseTrackUpdate refuse les entrées invalides", () => {
  assert.ok(parseTrackUpdate({}).error);
  assert.ok(parseTrackUpdate(null).error);
  assert.ok(parseTrackUpdate({ title: "   " }).error);
  assert.ok(parseTrackUpdate({ title: "x".repeat(121) }).error);
  assert.ok(parseTrackUpdate({ visibility: "everyone" }).error);
  assert.ok(parseTrackUpdate({ sharedWith: "abc" }).error);
  assert.ok(parseTrackUpdate({ sharedWith: ["pas-un-id"] }).error);
});

test("toTrackResponse montre sharedWith au propriétaire seulement", () => {
  const raw = privateTrack({
    _id: new mongoose.Types.ObjectId(),
    title: "Riff",
    originalName: "riff.mp3",
    mimeType: "audio/mpeg",
    size: 3,
    sharedWith: [{ _id: friendOid, name: "Bob" }],
  });
  const forOwner = toTrackResponse(raw, String(ownerOid));
  assert.deepEqual(forOwner.sharedWith, [{ id: String(friendOid), name: "Bob" }]);
  assert.equal("sharedWithMe" in forOwner, false);

  const forFriend = toTrackResponse(raw, String(friendOid));
  assert.equal("sharedWith" in forFriend, false);
  assert.equal(forFriend.sharedWithMe, true);

  const forStranger = toTrackResponse(raw, String(strangerOid));
  assert.equal(forStranger.sharedWithMe, false);
});

test("le modèle Track a un sharedWith vide par défaut", () => {
  const track = new Track({
    ownerId: ownerOid,
    title: "T",
    originalName: "t.mp3",
    storedName: "t.mp3",
    mimeType: "audio/mpeg",
    size: 1,
  });
  assert.equal(track.sharedWith.length, 0);
  assert.deepEqual(track.toPublic().sharedWith, []);
});

test("les routes de modification et d'arrêt de partage exigent un JWT", async () => {
  const id = String(new mongoose.Types.ObjectId());
  const patch = await fetch(`${base}/api/tracks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "x" }),
  });
  assert.equal(patch.status, 401);
  const unshare = await fetch(`${base}/api/tracks/${id}/shares/${id}`, { method: "DELETE" });
  assert.equal(unshare.status, 401);
});

// --- Mission TP4-3 : activité des amis ---

test("le filtre d'activité ne retient que les pistes d'amis visibles par l'utilisateur", () => {
  assert.deepEqual(buildFriendActivityFilter("me", ["f1", "f2"]), {
    ownerId: { $in: ["f1", "f2"] },
    $or: [
      { visibility: "public" },
      { isPublic: true },
      { visibility: "friends" },
      { sharedWith: "me" },
    ],
  });
});

test("sans ami, le filtre d'activité ne peut correspondre à aucune piste", () => {
  assert.deepEqual(buildFriendActivityFilter("me").ownerId, { $in: [] });
});

test("le fil d'activité fusionne pistes et amitiés par date décroissante", () => {
  const feed = buildActivityFeed({
    tracks: [
      { id: "t1", ownerId: "alice", ownerName: "Alice", title: "Blues", createdAt: "2026-11-10T10:00:00Z" },
      { id: "t2", ownerId: "bob", ownerName: "Bob", title: "Jazz", createdAt: "2026-11-12T10:00:00Z" },
    ],
    friendships: [
      { id: "f1", date: new Date("2026-11-11T10:00:00Z"), user: { id: "alice", name: "Alice" } },
    ],
  });
  assert.deepEqual(feed.map((item) => item.id), ["track:t2", "friendship:f1", "track:t1"]);
  assert.equal(feed[0].type, "track");
  assert.deepEqual(feed[0].user, { id: "bob", name: "Bob" });
  assert.equal(feed[0].track.title, "Jazz");
  assert.equal(feed[1].type, "friendship");
  assert.equal("track" in feed[1], false);
});

test("le fil d'activité respecte la limite et accepte des entrées vides", () => {
  const tracks = Array.from({ length: 5 }, (_, index) => ({
    id: `t${index}`,
    ownerId: "alice",
    ownerName: "Alice",
    createdAt: new Date(2026, 0, index + 1),
  }));
  const feed = buildActivityFeed({ tracks, limit: 2 });
  assert.deepEqual(feed.map((item) => item.id), ["track:t4", "track:t3"]);
  assert.deepEqual(buildActivityFeed({}), []);
});

test("l'activité des amis exige un JWT", async () => {
  const response = await fetch(base + "/api/friends/activity");
  assert.equal(response.status, 401);
});

// --- Mission TP4-4 : téléchargement et couverture ---

// Jeton signé avec le secret de développement : il passe le middleware auth
// sans MongoDB, ce qui permet de tester les refus décidés avant tout accès base.
function testToken() {
  const secret = process.env.JWT_SECRET || "tp1-development-secret";
  return jwt.sign({ sub: String(new mongoose.Types.ObjectId()) }, secret, { expiresIn: "5m" });
}

function uploadedFiles() {
  return fs.readdirSync(path.resolve("data/uploads")).sort();
}

test("isAcceptedUpload distingue les champs audio et cover", () => {
  assert.equal(isAcceptedUpload("audio", "audio/mpeg"), true);
  assert.equal(isAcceptedUpload("audio", "image/png"), false);
  assert.equal(isAcceptedUpload("cover", "image/png"), true);
  assert.equal(isAcceptedUpload("cover", "image/webp"), true);
  assert.equal(isAcceptedUpload("cover", "image/svg+xml"), false);
  assert.equal(isAcceptedUpload("cover", "audio/mpeg"), false);
  assert.equal(isAcceptedUpload("autre", "image/png"), false);
});

test("hasCover reflète la présence d'une couverture sans exposer son nom", () => {
  const baseTrack = {
    _id: new mongoose.Types.ObjectId(),
    ownerId: new mongoose.Types.ObjectId(),
    title: "T",
    originalName: "t.mp3",
    mimeType: "audio/mpeg",
    size: 1,
  };
  assert.equal(toTrackResponse(baseTrack).hasCover, false);
  const withCover = toTrackResponse({ ...baseTrack, coverMimeType: "image/png", coverStoredName: "c.png" });
  assert.equal(withCover.hasCover, true);
  assert.equal("coverStoredName" in withCover, false);

  const model = new Track({ ...baseTrack, storedName: "t.mp3", coverStoredName: "c.png", coverMimeType: "image/png" });
  assert.equal(model.toPublic().hasCover, true);
  assert.equal("coverStoredName" in model.toPublic(), false);
  assert.equal(Track.schema.path("coverStoredName").options.select, false);
});

test("la couverture exige un JWT", async () => {
  const id = String(new mongoose.Types.ObjectId());
  const response = await fetch(`${base}/api/tracks/${id}/cover`);
  assert.equal(response.status, 401);
});

test("un upload avec une couverture non image est refusé sans laisser de fichier", async () => {
  const before = uploadedFiles();
  const body = new FormData();
  body.append("title", "Test");
  body.append("audio", new Blob(["audio"], { type: "audio/mpeg" }), "a.mp3");
  body.append("cover", new Blob(["<svg/>"], { type: "image/svg+xml" }), "c.svg");
  const response = await fetch(base + "/api/tracks", {
    method: "POST",
    headers: { Authorization: `Bearer ${testToken()}` },
    body,
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /image/);
  assert.deepEqual(uploadedFiles(), before);
});

test("un upload avec une couverture de plus de 2 Mo est refusé et nettoyé", async () => {
  const before = uploadedFiles();
  const body = new FormData();
  body.append("audio", new Blob(["audio"], { type: "audio/mpeg" }), "a.mp3");
  body.append("cover", new Blob([new Uint8Array(MAX_COVER_SIZE + 1)], { type: "image/png" }), "c.png");
  const response = await fetch(base + "/api/tracks", {
    method: "POST",
    headers: { Authorization: `Bearer ${testToken()}` },
    body,
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /2 Mo/);
  assert.deepEqual(uploadedFiles(), before);
});

test("un upload sans fichier audio est refusé, même avec une couverture", async () => {
  const before = uploadedFiles();
  const body = new FormData();
  body.append("cover", new Blob(["png"], { type: "image/png" }), "c.png");
  const response = await fetch(base + "/api/tracks", {
    method: "POST",
    headers: { Authorization: `Bearer ${testToken()}` },
    body,
  });
  assert.equal(response.status, 400);
  assert.deepEqual(uploadedFiles(), before);
});

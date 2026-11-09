const express = require("express");

const port = Number(process.env.PORT || 3000);
const password = process.env["DB_PASSWORD"];

const app = express();
const notes = [];

app.get("/notes", (req, res) => {
  res.json(notes);
});

app.post("/notes", express.json(), (req, res) => {
  if (!req.body || typeof req.body.text !== "string") {
    res.status(400).json({ error: "text is required" });
    return;
  }
  notes.push({ text: req.body.text });
  res.status(201).json({ ok: true });
});

app.listen(port);

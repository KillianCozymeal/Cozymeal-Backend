import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import PDFDocument from "pdfkit";
import OpenAI from "openai";

const app = express();
app.use(cors());
// ✅ Désactiver bodyParser pour le webhook Shopify uniquement
app.use((req, res, next) => {
  if (req.originalUrl === "/shopify/webhook") {
    next(); // ne pas parser le JSON pour cette route
  } else {
    bodyParser.json()(req, res, next);
  }
});




const openai = new OpenAI({ apiKey:"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"});
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Initialisation Firebase
admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)),
});
const db = admin.firestore();

// Enregistre les infos client
app.post("/save-profile", async (req, res) => {
  try {
    const data = req.body;
    const ref = await db.collection("profiles").add(data);
    res.json({ ok: true, profile_id: ref.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Webhook pour commande Shopify
app.post("/webhook/orders", async (req, res) => {
  try {
    const order = req.body;
    const email = order.email;
    let profileId = null;

    for (const item of order.line_items) {
      if (item.properties) {
        const prop = item.properties.find((p) => p.name === "profile_id");
        if (prop) profileId = prop.value;
      }
    }

    if (!profileId) return res.status(200).send("Pas de profil trouvé.");

    const doc = await db.collection("profiles").doc(profileId).get();
    if (!doc.exists) return res.status(200).send("Profil inexistant.");
    const profile = doc.data();

    const prompt = `
Tu es un coach nutrition. 
Données: ${profile.age} ans, ${profile.poids} kg, ${profile.taille} cm, ${profile.sexe}, activité ${profile.activite}, objectif ${profile.objectif}.
Crée un plan alimentaire de 7 jours, clair, détaillé, avec les quantités, calories et un ton professionnel CozyMeal.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const planText = completion.choices[0].message.content;

   // --- 🧾 Création du PDF CozyMeal Design ---
const docPdf = new PDFDocument({ margin: 50 });

// --- Buffer pour la génération ---
const buffers = [];
docPdf.on("data", buffers.push.bind(buffers));
docPdf.on("end", async () => {
  const pdfData = Buffer.concat(buffers);

  const msg = {
    to: email,
    from: "mycozymeal@gmail.com",
    subject: "Ton programme alimentaire personnalisé - CozyMeal",
    text: "Merci pour ta commande ! Ton programme personnalisé est en pièce jointe 💪",
    attachments: [
      {
        content: pdfData.toString("base64"),
        filename: "Programme_CozyMeal.pdf",
        type: "application/pdf",
        disposition: "attachment",
      },
    ],
  };

  await sgMail.send(msg);
  console.log("✅ Programme envoyé avec succès à :", email);
});

// === PAGE 1 — Profil & résumé ===
docPdf.rect(0, 0, docPdf.page.width, docPdf.page.height).fill("#FFF6F3"); // fond cozy
docPdf.fillColor("#F26835");

// Logo CozyMeal
try {
  docPdf.image("/opt/render/project/src/https://cdn.shopify.com/s/files/1/0945/8047/4240/files/CozyMeal_Logo_-_Lunch_Box_Brand.png?v=1759249673", docPdf.page.width / 2 - 60, 40, { width: 120 });
} catch (err) {
  console.warn("⚠️ Logo introuvable sur Render, tu peux le placer dans /src si besoin");
}

docPdf.moveDown(6);
docPdf.fontSize(22).text("Programme Alimentaire Personnalisé", { align: "center" });
docPdf.moveDown(2);

// Section profil client
docPdf.fontSize(14).fillColor("#000");
docPdf.text(`Sexe : ${profile.sexe}`);
docPdf.text(`Âge : ${profile.age} ans`);
docPdf.text(`Taille : ${profile.taille} cm`);
docPdf.text(`Poids : ${profile.poids} kg`);
docPdf.text(`Activité : ${profile.activite}`);
docPdf.text(`Objectif : ${profile.objectif}`);
docPdf.text(`Allergies / Préférences : ${profile.allergies || "Aucune"}`);
docPdf.moveDown(2);

// Ligne de séparation
docPdf.moveTo(50, docPdf.y).lineTo(550, docPdf.y).stroke("#F26835");
docPdf.moveDown(2);

// Résumé général
docPdf.fontSize(16).fillColor("#F26835").text("Résumé du programme", { underline: true });
docPdf.moveDown(1);
docPdf.fontSize(12).fillColor("#000").text(
  profile.objectif === "Perdre du gras"
    ? "Ton plan est conçu pour t’aider à perdre du gras tout en conservant ton énergie. L’accent est mis sur les protéines maigres, les légumes et les glucides complexes."
    : "Ton plan t’aidera à prendre du muscle de façon saine, en augmentant ton apport en protéines et en glucides de qualité."
);
docPdf.moveDown(1.5);
docPdf.text("Chaque journée est équilibrée pour t’apporter les bons nutriments, sans frustration ni excès.", { align: "justify" });

// Pied de page
docPdf.fontSize(10).fillColor("#999").text("© CozyMeal - Programme personnalisé généré automatiquement", 50, 760, { align: "center" });

// === PAGE 2 — Plan détaillé GPT ===
docPdf.addPage();
docPdf.rect(0, 0, docPdf.page.width, docPdf.page.height).fill("#FFF6F3");
docPdf.fillColor("#F26835").fontSize(20).text("Plan alimentaire détaillé (7 jours)", { align: "center" });
docPdf.moveDown(1.5);

docPdf.fontSize(12).fillColor("#000").text(planText, { align: "left", lineGap: 6 });

// Pied de page page 2
docPdf.fontSize(10).fillColor("#999").text("CozyMeal - Mange bien, vis mieux 💛", 50, 760, { align: "center" });

docPdf.end();


    res.status(200).send("Programme généré et envoyé.");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur : " + err.message);
  }
});
// --- Webhook Shopify pour les commandes payées ---
import crypto from "crypto";

function verifyShopifyWebhook(req) {
  const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

  const digest = crypto
    .createHmac("sha256", secret)
    .update(req.rawBody, "utf8") // ici on utilise le corps BRUT
    .digest("base64");

  const match = crypto.timingSafeEqual(
    Buffer.from(digest, "utf8"),
    Buffer.from(hmacHeader, "utf8")
  );

  return match;
}

import getRawBody from "raw-body";

app.post("/shopify/webhook", async (req, res) => {
  console.log("📦 Webhook Shopify reçu !");
  try {
    const rawBody = await getRawBody(req);
    const hmacHeader = req.get("X-Shopify-Hmac-Sha256");
    const secret = process.env.SHOPIFY_WEBHOOK_SECRET;

    const digest = crypto
      .createHmac("sha256", secret)
      .update(rawBody, "utf8")
      .digest("base64");

    if (digest !== hmacHeader) {
      console.log("❌ Signature invalide Shopify");
      return res.status(401).send("Unauthorized");
    }

    console.log("✅ Signature valide Shopify !");
    const order = JSON.parse(rawBody.toString("utf8"));
    console.log("Commande reçue :", order.id);

    const email = order.email;
    const profileId = order.line_items?.[0]?.properties?.profile_id;

    if (!profileId) {
      console.log("⚠️ Pas de profil lié à la commande");
      return res.status(200).send("No profile ID");
    }

    // 🔥 Récupération du profil depuis Firebase
    const doc = await db.collection("profiles").doc(profileId).get();
    if (!doc.exists) {
      console.log("⚠️ Profil introuvable :", profileId);
      return res.status(200).send("Profile not found");
    }

    const profile = doc.data();

    // --- 🧠 Génération du plan avec OpenAI ---
    const prompt = `
Tu es un coach nutrition expert de la marque CozyMeal, spécialiste du bien-être et de la nutrition durable.
Ta mission est de créer un **programme alimentaire de 7 jours 100% personnalisé** pour ton client.

Voici ses informations :
- Sexe : ${profile.sexe}
- Âge : ${profile.age} ans
- Taille : ${profile.taille} cm
- Poids : ${profile.poids} kg
- Activité : ${profile.activite}
- Objectif : ${profile.objectif}
- Allergies ou préférences : ${profile.allergies || "Aucune"}

🔸 **Objectif :**
Rédige un plan adapté à ce profil, clair, motivant et humain. 
Chaque journée doit comprendre :
- Petit-déjeuner
- Déjeuner
- Dîner
- Collation(s)
Inclure les **quantités approximatives**, les **calories estimées**, et **des conseils pratiques**.

🔸 **Ton :**
Chaleureux, encourageant et professionnel — comme un vrai coach CozyMeal.
Évite le jargon, sois naturel, positif, et donne envie au client de suivre le plan.

🔸 **Mise en forme :**
Rédige le texte de manière fluide, structurée par jour :
Jour 1 :
Petit-déjeuner : ...
Déjeuner : ...
Dîner : ...
Collations : ...
etc. jusqu’à Jour 7.

🔸 **Conseils finaux :**
Ajoute à la fin du plan une petite note personnalisée de motivation signée CozyMeal, par exemple :
"Rappelle-toi : ce n’est pas une course, mais un chemin vers ton bien-être. On avance ensemble 💛"

Génère uniquement le texte final du plan (pas de balises Markdown).
`;


    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    });

    const planText = completion.choices[0].message.content;

    // --- 🧾 Création du PDF ---
    const docPdf = new PDFDocument();
    const buffers = [];
    docPdf.on("data", buffers.push.bind(buffers));
    docPdf.on("end", async () => {
      const pdfData = Buffer.concat(buffers);

      const msg = {
        to: email,
        from: "mycozymeal@gmail.com",
        subject: "Ton programme alimentaire personnalisé - CozyMeal",
        text: "Merci pour ta commande ! Ton programme personnalisé est en pièce jointe 💪",
        attachments: [
          {
            content: pdfData.toString("base64"),
            filename: "Programme_CozyMeal.pdf",
            type: "application/pdf",
            disposition: "attachment",
          },
        ],
      };

      await sgMail.send(msg);
      console.log("✅ Programme envoyé avec succès à :", email);
    });

    // --- 🧩 Design du PDF ---
    docPdf.fillColor("#F26835").fontSize(26).text("CozyMeal", { align: "center" });
    docPdf.moveDown().fillColor("#000").fontSize(16).text("Programme alimentaire personnalisé", { align: "center" });
    docPdf.moveDown().fontSize(12).text(planText);
    docPdf.end();

    res.status(200).send("Programme généré et envoyé !");
  } catch (err) {
    console.error("💥 Erreur webhook Shopify :", err);
    res.status(500).send("Server error");
  }
});




// ✅ Fin du fichier
app.listen(3000, () => console.log("API CozyMeal opérationnelle 🚀"));

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import admin from "firebase-admin";
import sgMail from "@sendgrid/mail";
import PDFDocument from "pdfkit";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(bodyParser.json());

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

    // Crée le PDF
    const docPdf = new PDFDocument();
    const buffers = [];
    docPdf.on("data", buffers.push.bind(buffers));
    docPdf.on("end", async () => {
      const pdfData = Buffer.concat(buffers);

      const msg = {
        to: email,
        from: "mycozymeal@gmail.com",
        subject: "Ton programme alimentaire personnalisé - CozyMeal",
        text: "Merci pour ta commande ! Ton programme est en pièce jointe.",
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
    });

    // Design du PDF
    docPdf.fillColor("#F26835").fontSize(24).text("CozyMeal", { align: "center" });
    docPdf.moveDown().fillColor("#000").fontSize(16).text("Programme alimentaire personnalisé", { align: "center" });
    docPdf.moveDown().fontSize(12).text(planText);
    docPdf.end();

    res.status(200).send("Programme généré et envoyé.");
  } catch (err) {
    console.error(err);
    res.status(500).send("Erreur : " + err.message);
  }
});

app.get("/", (req, res) => res.send("API CozyMeal opérationnelle 🚀"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur CozyMeal sur le port ${PORT}`));

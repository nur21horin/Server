const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const express = require("express");
const cors = require("cors");
require("dotenv").config();
const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FIREBASE_SERVICE_KEY, "base64");
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const app = express();
const port = process.env.PORT || 3000;


const allowedOrigins = [
  "http://localhost:3000", // your local frontend
  "https://ephemeral-chebakia-89a6e4.netlify.app", // deployed frontend
];

app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (like Postman or server-to-server)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) === -1) {
        const msg =
          "The CORS policy for this site does not allow access from the specified Origin.";
        return callback(new Error(msg), false);
      }
      return callback(null, true);
    },
    credentials: true, // if you need cookies/auth headers
  })
);

app.use(express.json());

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized: No token provided" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    return res
      .status(401)
      .send({ message: "Unauthorized: Invalid token", error });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gikxdnx.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

app.get("/", (req, res) => {
  res.send("SharePlate Server is Running...");
});

async function run() {
  try {
    await client.connect();
    const db = client.db("foodDB");
    const foodCollection = db.collection("foods");
    const requestsCollection = db.collection("requests");

    app.post("/foods", verifyToken, async (req, res) => {
      try {
        const food = req.body;
        food.food_status = "Available";
        food.donator_email = req.user.email;
        const result = await foodCollection.insertOne(food);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to add food", error });
      }
    });

    app.post("/requests", verifyToken, async (req, res) => {
      const { food_id, user_name } = req.body;
      const user_email = req.user.email;
      if (!food_id || !user_email || !user_name)
        return res.status(400).send({ message: "Missing required fields" });
      try {
        const food = await foodCollection.findOne({
          _id: new ObjectId(food_id),
          food_status: "Available",
        });
        if (!food)
          return res.status(404).send({ message: "Food not available" });
        const existing = await requestsCollection.findOne({
          food_id,
          user_email,
        });
        if (existing)
          return res
            .status(409)
            .send({ message: "Already requested this food" });
        const requestDoc = {
          food_id,
          user_name,
          user_email,
          requested_at: new Date(),
          status: "Pending",
        };
        const result = await requestsCollection.insertOne(requestDoc);
        res.status(201).send({
          message: "Request submitted successfully",
          requestId: result.insertedId,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to submit request", error });
      }
    });

    app.delete("/requests/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      try {
        const result = await requestsCollection.deleteOne({
          _id: new ObjectId(id),
          user_email: req.user.email,
        });
        if (result.deletedCount === 0)
          return res
            .status(404)
            .send({ message: "Request not found or unauthorized" });
        res.send({ message: "Request deleted successfully" });
      } catch (error) {
        res.status(500).send({ message: "Failed to delete request", error });
      }
    });

    app.get("/requests/:email", verifyToken, async (req, res) => {
      if (req.params.email !== req.user.email)
        return res.status(403).send({ message: "Forbidden: Access denied" });
      try {
        const requests = await requestsCollection
          .find({ user_email: req.user.email })
          .toArray();
        res.send(requests);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch requests", error });
      }
    });

    app.patch("/requests/:id", verifyToken, async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;
      if (!["Accepted", "Rejected"].includes(status))
        return res.status(400).send({ message: "Invalid status" });
      try {
        const request = await requestsCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!request)
          return res.status(404).send({ message: "Request not found" });
        const food = await foodCollection.findOne({
          _id: new ObjectId(request.food_id),
        });
        if (food.donator_email !== req.user.email)
          return res
            .status(403)
            .send({ message: "Forbidden: Only owner can update" });
        await requestsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );
        if (status === "Accepted")
          await foodCollection.updateOne(
            { _id: new ObjectId(request.food_id) },
            { $set: { food_status: "Donated" } }
          );
        res.send({ message: `Request ${status.toLowerCase()} successfully.` });
      } catch (error) {
        res.status(500).send({ message: "Failed to update request", error });
      }
    });

    app.put("/foods/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { _id, ...updatedFood } = req.body;
      try {
        const food = await foodCollection.findOne({ _id: new ObjectId(id) });
        if (!food) return res.status(404).send({ message: "Food not found" });
        if (food.donator_email !== req.user.email)
          return res
            .status(403)
            .send({ message: "Forbidden: Only owner can update" });
        const result = await foodCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedFood }
        );
        res.send({ message: "Food updated successfully", result });
      } catch (error) {
        res.status(500).send({ message: "Failed to update food", error });
      }
    });

    app.delete("/foods/:id", verifyToken, async (req, res) => {
      const id = req.params.id;
      try {
        const food = await foodCollection.findOne({ _id: new ObjectId(id) });
        if (!food) return res.status(404).send({ message: "Food not found" });
        if (food.donator_email !== req.user.email)
          return res
            .status(403)
            .send({ message: "Forbidden: Only owner can delete" });
        await foodCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ message: "Food deleted successfully" });
      } catch (error) {
        res.status(500).send({ message: "Failed to delete food", error });
      }
    });

    app.get("/foods", async (req, res) => {
      try {
        const foods = await foodCollection
          .find({ food_status: "Available" })
          .toArray();
        res.send(foods);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch foods", error });
      }
    });

    app.get("/foods/featured", async (req, res) => {
      try {
        const topFoods = await foodCollection
          .find({ food_status: "Available", featured: true })
          .limit(6)
          .toArray();
        res.send(topFoods);
      } catch (error) {
        res
          .status(500)
          .send({ message: "Failed to fetch featured foods", error });
      }
    });

    app.get("/foods/:id", async (req, res) => {
      const id = req.params.id;
      try {
        const food = await foodCollection.findOne({ _id: new ObjectId(id) });
        if (!food) return res.status(404).send({ message: "Food not found" });
        res.send(food);
      } catch (error) {
        res.status(500).send({ message: "Invalid ID format" });
      }
    });

    app.get("/my-foods/:email", verifyToken, async (req, res) => {
      if (req.params.email !== req.user.email)
        return res.status(403).send({ message: "Forbidden: Access denied" });
      try {
        const result = await foodCollection
          .find({ donator_email: req.user.email })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch user foods", error });
      }
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error);
  }
}

run().catch(console.dir);

if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

module.exports = app;

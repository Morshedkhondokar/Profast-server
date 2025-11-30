const express = require('express');
const cors = require('cors');
const  dotenv = require('dotenv')
const { MongoClient, ObjectId, ServerApiVersion } = require('mongodb');
const Stripe = require('stripe')
const admin = require("firebase-admin");


dotenv.config();
const stripe = new Stripe(process.env.PAYMENT_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json()); // to parse JSON request bodies


// firbase admin key
const serviceAccount = require("./firebase-admin-key.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});




//========================= MongoDB connection setup =========================//
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.negonxc.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server (optional starting in v4.7)
    await client.connect();

    const db = client.db("parcelDB");      // your database name
    const usersCollection = db.collection("users") // users collection 
    const parcelsCollection = db.collection("parcels"); // your collection
    const paymentsCollection = db.collection("payments"); // payment history collection
    // const trackingCollection = db.collection("tracking"); // tracking updates collection

    //============= custom Middleware 
    const verifyFBToken = async (req, res, next)=>{
      const authHeader = req.headers.authorization;
      if(!authHeader){
        return res.status(401).send({message: "unauthorized access"})
      }

      const token = authHeader.split(' ')[1]
      if(!token){
        return res.status(401).send({message: "unauthorized access"})
      }

      //========= verify the token
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();

      } catch (error) {
           return res.status(403).send({message: "forbidden access"})
      } 

 
    } 

    // Post: creat a new user
    app.post('/users', async (req, res)=>{
      const email = req.body.email;
      const userExists = await usersCollection.findOne({email})

      if(userExists){
        const lastLogin = req.body.last_login_data
        // UPDATE last login date
      const updateRes = await usersCollection.updateOne({ email },
        { $set: { last_login_date: lastLogin} });     
        
        return res.status(200).send({message: "user already exists",  updated: true})
      }

      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result)

    })


    // GET: All parcels or parcels by user (senderEmail), sorted by latest
   app.get("/parcels", verifyFBToken, async (req, res) => {
  try {
    // Token theke email
    const tokenEmail = req.decoded.email;

    // Only logged-in user's parcels
    const query = { senderEmail: tokenEmail };

    const options = { sort: { createdAt: -1 } };

    const parcels = await parcelsCollection.find(query, options).toArray();

    res.send(parcels);
  } catch (error) {
    console.log("Error fetching parcels:", error);
    res.status(500).json({ message: "Failed to get parcels." });
  }
});



    // POST: Create a new parcel 
    app.post("/parcels", async (req, res) => {
        try {
            const newParcel = req.body;
            const result = await parcelsCollection.insertOne(newParcel);
            res.status(201).send(result);
        } catch (error) {
            console.log('Error inserting parcel:', error);
            res.status(500).json({ message: "Failed to add parcel" });
        }
    });


    // GET: Get a single parcel by ID
  app.get("/parcels/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const query = { _id: new ObjectId(id) };

    const parcel = await parcelsCollection.findOne(query);

    if (!parcel) {
      return res.status(404).json({ message: "Parcel not found" });
    }

    res.json(parcel);
  } catch (error) {
    console.error("Error fetching parcel by ID:", error);
    res.status(500).json({ message: "Failed to get parcel" });
  }
});


  // DELETE: delete a parcel by ID
  app.delete("/parcels/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const query = { _id: new ObjectId(id) };

    const result = await parcelsCollection.deleteOne(query);

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Parcel not found" });
    }

    res.send(result);
  } catch (error) {
    console.log("Error deleting parcel:", error);
    res.status(500).json({ message: "Failed to delete parcel" });
  }
});



// POST: Add a new tracking update (one document per update)
// app.post("/tracking/update", async (req, res) => {
//     try {
//         const { parcelId, trackingId, status, location } = req.body;

//         if (!parcelId || !trackingId || !status) {
//             return res.status(400).json({ message: "Missing required fields (parcelId, trackingId, status)." });
//         }

//         // 1. Create the new tracking record
//         const newTrackingRecord = {
//             parcelId: parcelId,
//             trackingId: trackingId,
//             status: status,
//             location: location || "N/A", // Location is optional
//             timestamp: new Date()
//         };

//         const result = await trackingCollection.insertOne(newTrackingRecord);

//         // 2. Optionally, update the main 'parcels' collection with the latest status
//         // This is good for displaying the current status quickly in lists
//         const updateParcelResult = await parcelsCollection.updateOne(
//             { _id: new ObjectId(parcelId) },
//             { $set: { currentStatus: status, lastUpdated: newTrackingRecord.timestamp } }
//         );


//         res.status(201).json({
//             message: "Tracking update successfully recorded.",
//             insertedId: result.insertedId,
//             parcelUpdate: updateParcelResult.modifiedCount > 0 ? true : false
//         });

//     } catch (error) {
//         console.error("Error inserting tracking update:", error);
//         res.status(500).json({ message: "Failed to insert tracking update." });
//     }
// });





  // ========================= Stripe Payment Integration =========================//
  app.post('/create-payment-intent', verifyFBToken, async (req, res) => {
    const amountInCents = req.body.amountInCents
    try {
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: 'usd',
        payment_method_types: ['card'],
      })
      res.json({ clientSecret: paymentIntent.client_secret });
    }catch (error) {
      console.log("Error creating payment intent:", error);
      res.status(500).json({ message: "Failed to create payment intent" });
    }
  });


  // PATCH: Mark parcel as paid & add payment history
app.post("/parcels/payment/:id", async (req, res) => {
  try {
    const parcelId = req.params.id;
    const paymentInfo = req.body;

    // 1️⃣ Update parcel payment status
    const filter = { _id: new ObjectId(parcelId) };
    const updateParcel = {
      $set: {
        paymentStatus: "paid",
      }
    };

    const parcelResult = await parcelsCollection.updateOne(filter, updateParcel);

    // 2️⃣ Insert into payment history
    const paymentRecord = {
      parcelId,
      userEmail: paymentInfo.email,
      amount: paymentInfo.amount,
      paymentMethod: paymentInfo.paymentMethod,
      status: "paid",
      createdAt: new Date()
    };

    const paymentResult = await paymentsCollection.insertOne(paymentRecord);

    res.status(201).send({
      message: "Payment updated and recorded successfully",
      insertedId: paymentResult.insertedId
    })

  } catch (error) {
    console.log("Payment update error:", error);
    res.status(500).json({ message: "Failed to update payment" });
  }
});

  // GET: Payment history for a user
app.get("/payments/user/:email", verifyFBToken,  async (req, res) => {
  try {
    const email = req.params.email;
    console.log('decoded', req.decoded)

    if(req.decoded.email !== email){
      return res.status(403).send({message: 'forbidden access'})
    }

    const query = { userEmail: email };
    const options = { sort: { createdAt: -1 } };

    const history = await paymentsCollection.find(query, options).toArray();

    res.send(history);
  } catch (error) {
    console.log("Error fetching user payment history:", error);
    res.status(500).json({ message: "Failed to load payment history" });
  }
});




    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// Sample route
app.get("/", (req, res) => {
  res.send("Parcel website server is running!");
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

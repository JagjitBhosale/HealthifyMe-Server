// server.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Gemini AI
const GEMINI_API_KEY = 'AIzaSyCQv-rhFFt79upmcFP_8cThTacd1vtxQbA'; // Replace with your API key
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Middleware
app.use(cors());
app.use(express.json());

// Configure multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Function to encode image to base64
function fileToGenerativePart(path, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(path)).toString('base64'),
      mimeType
    },
  };
}

// Analyze text for food calories
app.post('/api/analyze-text', async (req, res) => {
  try {
    const { text } = req.body;
    
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const prompt = `Analyze this food intake: "${text}"
    
    Provide ONLY a JSON response in this exact format:
    {
      "foodItem": "name of the food",
      "calories": number,
      "protein": number (in grams),
      "carbs": number (in grams),
      "fat": number (in grams),
      "quantity": "estimated quantity",
      "confidence": "high/medium/low"
    }
    
    If the text doesn't mention food, return:
    {
      "error": "No food item detected"
    }`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiResponse = response.text();   // ✅ renamed to avoid conflict
    
    // Extract JSON from response
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonData = JSON.parse(jsonMatch[0]);
      res.json(jsonData);
    } else {
      res.status(400).json({ error: 'Could not parse food information' });
    }
  } catch (error) {
    console.error('Error analyzing text:', error);
    res.status(500).json({ error: 'Failed to analyze text' });
  }
});

// Analyze image for food calories
app.post('/api/analyze-image', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const imagePart = fileToGenerativePart(req.file.path, req.file.mimetype);
    
    const prompt = `Analyze this food image and identify all food items visible.
    
    Provide ONLY a JSON response in this exact format:
    {
      "foodItem": "name of the food item(s)",
      "calories": total calories (number),
      "protein": total protein in grams (number),
      "carbs": total carbohydrates in grams (number),
      "fat": total fat in grams (number),
      "quantity": "estimated quantity/serving size",
      "confidence": "high/medium/low",
      "items": ["list", "of", "identified", "items"]
    }
    
    Be accurate with nutritional estimates based on typical serving sizes visible in the image.`;

    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const aiResponse = response.text();   // ✅ renamed here too
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    
    // Extract JSON from response
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonData = JSON.parse(jsonMatch[0]);
      res.json(jsonData);
    } else {
      res.status(400).json({ error: 'Could not parse food information' });
    }
  } catch (error) {
    console.error('Error analyzing image:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to analyze image' });
  }
});

// Calculate BMR and daily calories using Gemini AI
app.post('/api/calculate-bmr', async (req, res) => {
  try {
    const { weight, height, age, gender, activityLevel, goal } = req.body;
    
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const prompt = `Calculate BMR and daily calorie needs for a person with these details:
    - Weight: ${weight} kg
    - Height: ${height} cm
    - Age: ${age} years
    - Gender: ${gender}
    - Activity Level: ${activityLevel}
    - Goal: ${goal}
    
    Use the Mifflin-St Jeor Equation for BMR calculation and provide activity multipliers.
    Activity levels: sedentary (1.2), light (1.375), moderate (1.55), active (1.725), very active (1.9)
    
    For goals: maintain (no change), lose (-500 cal), gain (+500 cal)
    
    Provide ONLY a JSON response in this exact format:
    {
      "bmr": number,
      "maintenance": number,
      "target": number,
      "protein": number (2g per kg of body weight),
      "carbs": number (45% of target calories / 4),
      "fat": number (25% of target calories / 9),
      "explanation": "brief explanation of calculations"
    }`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiResponse = response.text();
    
    // Extract JSON from response
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonData = JSON.parse(jsonMatch[0]);
      res.json(jsonData);
    } else {
      // Fallback to manual calculation if AI fails
      const manualCalc = calculateBMRManually({ weight, height, age, gender, activityLevel, goal });
      res.json(manualCalc);
    }
  } catch (error) {
    console.error('Error calculating BMR:', error);
    // Fallback to manual calculation
    const manualCalc = calculateBMRManually(req.body);
    res.json(manualCalc);
  }
});

// Manual BMR calculation fallback
function calculateBMRManually(profile) {
  const { weight, height, age, gender, activityLevel, goal } = profile;
  
  // Mifflin-St Jeor Equation
  let bmr;
  if (gender === 'male') {
    bmr = 10 * weight + 6.25 * height - 5 * age + 5;
  } else {
    bmr = 10 * weight + 6.25 * height - 5 * age - 161;
  }
  
  // Activity multipliers
  const activityMultipliers = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    veryActive: 1.9
  };
  
  const maintenance = bmr * activityMultipliers[activityLevel];
  
  // Goal adjustments
  let targetCalories = maintenance;
  if (goal === 'lose') {
    targetCalories = maintenance - 500;
  } else if (goal === 'gain') {
    targetCalories = maintenance + 500;
  }
  
  return {
    bmr: Math.round(bmr),
    maintenance: Math.round(maintenance),
    target: Math.round(targetCalories),
    protein: Math.round(weight * 2),
    carbs: Math.round(targetCalories * 0.45 / 4),
    fat: Math.round(targetCalories * 0.25 / 9),
    explanation: "Calculated using Mifflin-St Jeor Equation"
  };
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

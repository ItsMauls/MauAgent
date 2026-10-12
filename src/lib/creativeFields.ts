// Structured library inputs per kind. They are saved as labelled lines in CreativeAsset.description, so every agent
// that already reads the description gets them with no schema change.
// main = always visible; the rest sit in the "Additional details" dropdown. Every field is a multi-select over `options`.
export const ASSET_FIELDS = {
  character: [
    { key: "look", label: "Look", main: true, options: ["Realistic human", "Cartoon", "Anime", "Animal / creature", "Robot / mascot", "Young", "Elegant", "Streetwear", "Cute", "Rugged"] },
    { key: "outfit", label: "Outfit", options: ["Casual", "Formal", "Uniform / apron", "Sportswear", "Traditional", "Streetwear", "Costume", "Glasses / accessories"] },
    { key: "age", label: "Age / species", options: ["Child", "Teen", "Young adult", "Adult", "Senior", "Human", "Animal", "Fantasy creature"] },
    { key: "personality", label: "Personality", options: ["Cheerful", "Calm", "Clumsy", "Confident", "Shy", "Funny", "Serious", "Energetic", "Friendly"] },
    { key: "voice", label: "Voice / mannerisms", options: ["Soft-spoken", "Energetic", "Deep", "Fast-talking", "Playful", "Deadpan", "Winks / smiles often"] },
  ],
  location: [
    { key: "place", label: "Place", main: true, options: ["Cafe", "Home / interior", "Street", "Office", "Studio", "Park / outdoor", "Market", "Beach", "Shop"] },
    { key: "time", label: "Time of day", options: ["Sunrise", "Morning", "Noon", "Golden hour", "Evening", "Night"] },
    { key: "props", label: "Props", options: ["Table & chairs", "Plants", "Neon signs", "Posters", "Counter / shelves", "Vehicles"] },
    { key: "atmosphere", label: "Atmosphere", options: ["Warm & cozy", "Busy", "Quiet", "Bright & airy", "Moody", "Colorful"] },
  ],
  style: [
    { key: "look", label: "Visual look", main: true, options: ["Flat 2D", "3D", "Pixel art", "Anime", "Claymation", "Live action", "Watercolor", "Retro / VHS"] },
    { key: "palette", label: "Color palette", options: ["Warm", "Cool", "Pastel", "Monochrome", "High contrast", "Neon"] },
    { key: "camera", label: "Camera / motion", options: ["Static", "Handheld", "Quick cuts", "Slow pans", "Close-ups", "Wide shots"] },
  ],
} as const;

/** Upload slots per kind. Characters get a full 360° turnaround so the Art Director can keep the design consistent from any angle. */
export const IMAGE_VIEWS = {
  character: ["Front", "Front right", "Right", "Back right", "Back", "Back left", "Left", "Front left", "Face close-up", "Detail"],
  location: ["Wide", "Left", "Right", "Behind", "Detail 1", "Detail 2"],
  style: ["Reference 1", "Reference 2", "Reference 3", "Reference 4"],
} as const;

export const viewLabel = (url: string) => new URL(url, "http://x").searchParams.get("v") ?? "";

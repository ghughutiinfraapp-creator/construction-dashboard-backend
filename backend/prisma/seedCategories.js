const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const PHASES = [
  {
    name: "Pre-Construction Work",
    order: 1,
    items: [
      "Soil Testing",
      "Site Clearing",
      "Demolition (if any)",
      "Levelling & Grading",
      "Setting Out",
      "Benchmark Fixing",
      "Temporary Fencing",
      "Site Access Road",
      "Water & Electricity (Temporary)",
      "Site Office Setup",
      "Labour Hutment Setup",
      "Material Storage Planning",
      "Machinery Placement",
      "Underground Utility",
      "Layout Approval",
    ],
  },
  {
    name: "Substructure Work (Foundation Level)",
    order: 2,
    items: [
      "Excavation Work",
      "Anti-Termite Treatment",
      "PCC (Plain Cement Concrete)",
      "Foundation Work",
      "Column Casting (Footing to Plinth)",
      "Plinth Beam",
      "Backfilling / RBM Filling",
      "Compaction Work",
      "Damp Proof Course (DPC)",
    ],
  },
  {
    name: "Superstructure Work",
    order: 3,
    items: [
      "Brick Work (Wall Construction)",
      "Door/Window Frame Fixing",
      "Lintel Work",
      "Slab Casting (Roof)",
      "Staircase Work",
    ],
  },
  {
    name: "MEP Work (Services)",
    order: 4,
    items: [
      "Electrical Conduiting",
      "Plumbing Line Installation",
      "Electrical Wiring",
      "Plumbing Drainage Fittings",
      "Water Tank & Fittings",
      "Septic Tank & Soak Pit",
    ],
  },
  {
    name: "Finishing Base Work",
    order: 5,
    items: [
      "Internal & External Plaster",
      "Waterproofing (Bathroom, Roof)",
      "Putty Work",
      "False Ceiling Framework",
    ],
  },
  {
    name: "Flooring & Stone Work",
    order: 6,
    items: ["Floor Tiling", "Staircase Tiles / Granite", "Skirting Work"],
  },
  {
    name: "Carpentry & Interior Work",
    order: 7,
    items: [
      "Door & Window Shutter Fitting",
      "Carpenter Work",
      "Modular Kitchen",
      "Wardrobe",
      "TV Unit",
      "Bed & Storage",
      "Cabinet & Drawer",
      "Glass Fixing",
      "Interior Design Work",
    ],
  },
  {
    name: "Metal & Exterior Work",
    order: 8,
    items: [
      "Railing Work",
      "Staircase Railing Design",
      "T-Angle for Cloth Drying",
      "Gate Installation",
      "Boundary Wall",
      "Outdoor Lighting",
    ],
  },
  {
    name: "Final Electrical & Fixtures",
    order: 9,
    items: [
      "Light Fitting",
      "Switch Board Fixing",
      "Sanitary Fixtures (WC, Basin, etc.)",
    ],
  },
  {
    name: "Final Finishing Stage",
    order: 10,
    items: [
      "Paint Work",
      "Gap Filling & Sealing",
      "Polish Work (if any)",
      "Final Cleaning",
      "Snag List Checking",
      "Final Handover",
    ],
  },
];

async function main() {
  console.log("🌱 Seeding task categories...\n");

  for (const phase of PHASES) {
    const existingPhase = await prisma.taskCategory.findFirst({
      where: { name: phase.name, parentId: null },
    });
    const parent = existingPhase
      ? await prisma.taskCategory.update({
          where: { id: existingPhase.id },
          data: { order: phase.order },
        })
      : await prisma.taskCategory.create({
          data: { name: phase.name, order: phase.order, isVisible: true },
        });

    for (let i = 0; i < phase.items.length; i++) {
      const existingItem = await prisma.taskCategory.findFirst({
        where: { name: phase.items[i], parentId: parent.id },
      });
      if (existingItem) {
        await prisma.taskCategory.update({
          where: { id: existingItem.id },
          data: { order: i + 1 },
        });
      } else {
        await prisma.taskCategory.create({
          data: {
            name: phase.items[i],
            order: i + 1,
            parentId: parent.id,
            isVisible: true,
          }, 
        });
      }
    }

    console.log(`  ✅ ${phase.name} (${phase.items.length} items)`);
  }

  console.log("\n🎉 Task categories seeded successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

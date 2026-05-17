const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding tasks...\n');

  // ── fetch references ──────────────────────────────────────────────
  const [projects, users, allCategories] = await Promise.all([
    prisma.project.findMany({ select: { id: true, name: true } }),
    prisma.user.findMany({ select: { id: true, name: true, role: true } }),
    prisma.taskCategory.findMany({ select: { id: true, name: true, parentId: true } }),
  ]);

  const project  = (name) => projects.find(p => p.name === name)?.id;
  const user     = (role) => users.find(u => u.role === role)?.id;
  const cat      = (name) => allCategories.find(c => c.name === name)?.id;
  const engineers = users.filter(u => u.role === 'SITE_ENGINEER');

  const gvr  = project('Green Valley Residency');
  const scc  = project('Sunrise Commercial Complex');
  const pm   = user('PROJECT_MANAGER');
  const eng1 = engineers[0]?.id;
  const eng2 = engineers[1]?.id ?? eng1;

  if (!gvr || !scc || !pm || !eng1) {
    throw new Error('Required projects/users not found. Run the main seed first.');
  }

  // ── clear existing tasks ──────────────────────────────────────────
  await prisma.task.deleteMany();
  console.log('  🗑  Cleared existing tasks\n');

  // ─────────────────────────────────────────────────────────────────
  // GREEN VALLEY RESIDENCY
  // Phase 1 (Pre-Construction) ✅  Phase 2 (Substructure) ✅
  // Phase 3 (Superstructure) 🔄   Phase 4 (MEP) ⏳ not started
  // ─────────────────────────────────────────────────────────────────
  console.log('  📋 Green Valley Residency');

  // ── Phase 1: Pre-Construction — flat tasks (no subtasks), all done ──
  await prisma.task.createMany({
    data: [
      { projectId: gvr, createdById: pm, assignedToId: eng1, categoryId: cat('Soil Testing'),       title: 'Soil Testing',       description: 'Bore hole soil test to determine bearing capacity at 3 locations.',    status: 'VERIFIED',   priority: 'HIGH',     startDate: new Date('2026-01-15'), dueDate: new Date('2026-01-22'), completedAt: new Date('2026-01-20') },
      { projectId: gvr, createdById: pm, assignedToId: eng1, categoryId: cat('Site Clearing'),      title: 'Site Clearing',      description: 'Remove existing vegetation, debris, and old structures.',             status: 'COMPLETED',  priority: 'HIGH',     startDate: new Date('2026-01-22'), dueDate: new Date('2026-01-28'), completedAt: new Date('2026-01-27') },
      { projectId: gvr, createdById: pm, assignedToId: eng1, categoryId: cat('Levelling & Grading'),title: 'Levelling & Grading', description: 'Machine grading to achieve design formation level.',                   status: 'COMPLETED',  priority: 'HIGH',     startDate: new Date('2026-01-28'), dueDate: new Date('2026-02-04'), completedAt: new Date('2026-02-03') },
      { projectId: gvr, createdById: pm, assignedToId: eng2, categoryId: cat('Temporary Fencing'),  title: 'Temporary Fencing',  description: 'GI sheet fencing around full site perimeter.',                        status: 'COMPLETED',  priority: 'MEDIUM',   startDate: new Date('2026-01-22'), dueDate: new Date('2026-01-25'), completedAt: new Date('2026-01-24') },
      { projectId: gvr, createdById: pm, assignedToId: eng2, categoryId: cat('Site Office Setup'),  title: 'Site Office Setup',  description: 'Prefab site office with electricity, internet, and safety board.',     status: 'COMPLETED',  priority: 'MEDIUM',   startDate: new Date('2026-01-25'), dueDate: new Date('2026-01-30'), completedAt: new Date('2026-01-29') },
      { projectId: gvr, createdById: pm, assignedToId: eng1, categoryId: cat('Layout Approval'),    title: 'Layout Approval',    description: 'Get layout marked and approved by local authority.',                   status: 'VERIFIED',   priority: 'CRITICAL', startDate: new Date('2026-02-01'), dueDate: new Date('2026-02-10'), completedAt: new Date('2026-02-08') },
    ],
  });
  console.log('    ✅ Phase 1 — Pre-Construction Work (6 flat tasks)');

  // ── Phase 2: Substructure — flat tasks, all done ──
  await prisma.task.createMany({
    data: [
      { projectId: gvr, createdById: pm, assignedToId: eng1, categoryId: cat('Excavation Work'),            title: 'Excavation Work',            description: 'Excavation to 1.8m depth for isolated footings as per structural drawing.', status: 'COMPLETED',  priority: 'HIGH',     startDate: new Date('2026-02-10'), dueDate: new Date('2026-02-25'), completedAt: new Date('2026-02-23') },
      { projectId: gvr, createdById: pm, assignedToId: eng1, categoryId: cat('Anti-Termite Treatment'),     title: 'Anti-Termite Treatment',     description: 'Chlorpyrifos chemical treatment on excavated soil bed.',                   status: 'COMPLETED',  priority: 'MEDIUM',   startDate: new Date('2026-02-24'), dueDate: new Date('2026-02-25'), completedAt: new Date('2026-02-25') },
      { projectId: gvr, createdById: pm, assignedToId: eng1, categoryId: cat('PCC (Plain Cement Concrete)'),title: 'PCC (Plain Cement Concrete)', description: 'M10 PCC 100mm thick below all footings.',                                  status: 'COMPLETED',  priority: 'HIGH',     startDate: new Date('2026-02-26'), dueDate: new Date('2026-03-05'), completedAt: new Date('2026-03-04') },
      { projectId: gvr, createdById: pm, assignedToId: eng1, categoryId: cat('Foundation Work'),            title: 'Foundation Work',            description: 'M25 RCC isolated footings for all 12 columns.',                           status: 'VERIFIED',   priority: 'CRITICAL', startDate: new Date('2026-03-05'), dueDate: new Date('2026-03-25'), completedAt: new Date('2026-03-22') },
      { projectId: gvr, createdById: pm, assignedToId: eng2, categoryId: cat('Plinth Beam'),                title: 'Plinth Beam',                description: 'M25 RCC plinth beam connecting all column footings.',                     status: 'COMPLETED',  priority: 'HIGH',     startDate: new Date('2026-03-26'), dueDate: new Date('2026-04-08'), completedAt: new Date('2026-04-06') },
      { projectId: gvr, createdById: pm, assignedToId: eng2, categoryId: cat('Damp Proof Course (DPC)'),   title: 'Damp Proof Course (DPC)',    description: '75mm DPC with waterproofing compound above plinth level.',                status: 'COMPLETED',  priority: 'MEDIUM',   startDate: new Date('2026-04-08'), dueDate: new Date('2026-04-12'), completedAt: new Date('2026-04-11') },
    ],
  });
  console.log('    ✅ Phase 2 — Substructure Work (6 flat tasks)');

  // ── Phase 3: Superstructure — flat tasks, in progress ──
  await prisma.task.createMany({
    data: [
      { projectId: gvr, createdById: pm, assignedToId: eng1, categoryId: cat('Brick Work (Wall Construction)'), title: 'Brick Work (Wall Construction)', description: 'AAC block 200mm external walls, 100mm internal partition — all floors.', status: 'IN_PROGRESS', priority: 'HIGH',     startDate: new Date('2026-04-15'), dueDate: new Date('2026-05-20') },
      { projectId: gvr, createdById: pm, assignedToId: eng2, categoryId: cat('Door/Window Frame Fixing'),       title: 'Door/Window Frame Fixing',       description: 'Fix teak wood frames for all doors and windows before lintel casting.',  status: 'NOT_STARTED', priority: 'HIGH',     startDate: new Date('2026-05-10'), dueDate: new Date('2026-05-18') },
      { projectId: gvr, createdById: pm, assignedToId: eng1, categoryId: cat('Lintel Work'),                    title: 'Lintel Work',                    description: 'M20 RCC lintels above all door and window openings.',                    status: 'NOT_STARTED', priority: 'MEDIUM',   startDate: new Date('2026-05-18'), dueDate: new Date('2026-05-28') },
      { projectId: gvr, createdById: pm, assignedToId: eng1, categoryId: cat('Slab Casting (Roof)'),            title: 'Slab Casting (Roof)',            description: 'M25 RCC 125mm flat slab for first floor roof.',                         status: 'NOT_STARTED', priority: 'CRITICAL', startDate: new Date('2026-06-01'), dueDate: new Date('2026-06-20') },
      { projectId: gvr, createdById: pm, assignedToId: eng1, categoryId: cat('Staircase Work'),                 title: 'Staircase Work',                 description: 'RCC staircase with 175mm risers and 250mm treads.',                     status: 'NOT_STARTED', priority: 'MEDIUM',   startDate: new Date('2026-06-20'), dueDate: new Date('2026-07-05') },
    ],
  });
  console.log('    ✅ Phase 3 — Superstructure Work (5 flat tasks)');

  // ── Phase 4: MEP Work — parent + subtasks in one nested create (Flow 1: category-based) ──
  await prisma.task.create({
    data: {
      projectId: gvr, createdById: pm, assignedToId: eng2,
      categoryId: null,
      title: 'MEP Work',
      description: 'Mechanical, Electrical & Plumbing for all floors.',
      status: 'NOT_STARTED', priority: 'HIGH',
      startDate: new Date('2026-07-01'), dueDate: new Date('2026-08-15'),
      subtasks: {
        create: [
          { projectId: gvr, createdById: pm, assignedToId: eng2, categoryId: cat('Electrical Conduiting'),    title: 'Electrical Conduiting',    description: 'Lay PVC conduit pipes in walls and slabs before plastering.',            status: 'NOT_STARTED', priority: 'HIGH',   startDate: new Date('2026-07-01'), dueDate: new Date('2026-07-15') },
          { projectId: gvr, createdById: pm, assignedToId: eng2, categoryId: cat('Plumbing Line Installation'),title: 'Plumbing Line Installation',description: 'CPVC supply lines and PVC drainage lines roughed in all floors.',         status: 'NOT_STARTED', priority: 'HIGH',   startDate: new Date('2026-07-01'), dueDate: new Date('2026-07-20') },
          { projectId: gvr, createdById: pm, assignedToId: eng2, categoryId: cat('Electrical Wiring'),        title: 'Electrical Wiring',        description: 'Pull copper wiring through conduits after plastering is complete.',       status: 'NOT_STARTED', priority: 'MEDIUM', startDate: new Date('2026-07-20'), dueDate: new Date('2026-08-05') },
          { projectId: gvr, createdById: pm, assignedToId: eng2, categoryId: cat('Water Tank & Fittings'),    title: 'Water Tank & Fittings',    description: '5000L overhead water tank with GI ball valves and float valve.',         status: 'NOT_STARTED', priority: 'MEDIUM', startDate: new Date('2026-08-01'), dueDate: new Date('2026-08-10') },
          { projectId: gvr, createdById: pm, assignedToId: eng2, categoryId: cat('Septic Tank & Soak Pit'),   title: 'Septic Tank & Soak Pit',   description: 'RCC septic tank 3000L with soak pit as per NBC norms.',                  status: 'NOT_STARTED', priority: 'MEDIUM', startDate: new Date('2026-08-05'), dueDate: new Date('2026-08-15') },
        ],
      },
    },
  });
  console.log('    ✅ Phase 4 — MEP Work (1 parent + 5 subtasks, category-based)');

  // ── Custom task with custom subtasks (Flow 2: no category) ──
  await prisma.task.create({
    data: {
      projectId: gvr, createdById: pm, assignedToId: eng2,
      categoryId: null,
      title: 'Staircase Design Change',
      description: 'Client requested staircase width increased from 1.2m to 1.5m.',
      status: 'IN_PROGRESS', priority: 'HIGH',
      startDate: new Date('2026-05-01'), dueDate: new Date('2026-05-15'),
      subtasks: {
        create: [
          { projectId: gvr, createdById: pm, assignedToId: eng1, categoryId: null, title: 'Get revised structural drawings from architect', status: 'IN_PROGRESS', priority: 'HIGH',   dueDate: new Date('2026-05-05') },
          { projectId: gvr, createdById: pm, assignedToId: eng2, categoryId: null, title: 'Get client approval on revised drawings',        status: 'NOT_STARTED', priority: 'HIGH',   dueDate: new Date('2026-05-08') },
          { projectId: gvr, createdById: pm, assignedToId: eng1, categoryId: null, title: 'Update BOQ for extra materials',                 status: 'NOT_STARTED', priority: 'MEDIUM', dueDate: new Date('2026-05-12') },
        ],
      },
    },
  });
  console.log('    ✅ Custom task + 3 custom subtasks (no category, Flow 2)\n');

  // ─────────────────────────────────────────────────────────────────
  // SUNRISE COMMERCIAL COMPLEX
  // Phase 1 (Pre-Construction) 🔄   Phase 2 (Substructure) ⏳
  // ─────────────────────────────────────────────────────────────────
  console.log('  📋 Sunrise Commercial Complex');

  // ── Phase 1: Pre-Construction — flat tasks, mixed status ──
  await prisma.task.createMany({
    data: [
      { projectId: scc, createdById: pm, assignedToId: eng1, categoryId: cat('Soil Testing'),        title: 'Soil Testing',        description: 'Soil investigation report with 5 bore holes for 15-floor load.',   status: 'VERIFIED',    priority: 'CRITICAL', startDate: new Date('2026-03-01'), dueDate: new Date('2026-03-10'), completedAt: new Date('2026-03-09') },
      { projectId: scc, createdById: pm, assignedToId: eng1, categoryId: cat('Demolition (if any)'), title: 'Demolition (if any)', description: 'Demolish existing 2-storey structure on plot. Salvage steel.',     status: 'COMPLETED',   priority: 'HIGH',     startDate: new Date('2026-03-10'), dueDate: new Date('2026-03-20'), completedAt: new Date('2026-03-18') },
      { projectId: scc, createdById: pm, assignedToId: eng2, categoryId: cat('Temporary Fencing'),   title: 'Temporary Fencing',   description: 'Hoarding with tin sheet fencing on all 4 sides, 8 feet height.',  status: 'COMPLETED',   priority: 'MEDIUM',   startDate: new Date('2026-03-10'), dueDate: new Date('2026-03-14'), completedAt: new Date('2026-03-13') },
      { projectId: scc, createdById: pm, assignedToId: eng2, categoryId: cat('Site Clearing'),       title: 'Site Clearing',       description: 'Remove demolition debris and level for next phase.',               status: 'IN_PROGRESS', priority: 'HIGH',     startDate: new Date('2026-03-19'), dueDate: new Date('2026-03-28') },
      { projectId: scc, createdById: pm, assignedToId: eng1, categoryId: cat('Levelling & Grading'), title: 'Levelling & Grading', description: 'Achieve design reduced level using vibratory roller.',              status: 'NOT_STARTED', priority: 'HIGH',     startDate: new Date('2026-03-28'), dueDate: new Date('2026-04-05') },
      { projectId: scc, createdById: pm, assignedToId: eng2, categoryId: cat('Site Office Setup'),   title: 'Site Office Setup',   description: 'Two-room prefab office with meeting area, toilet block.',          status: 'IN_PROGRESS', priority: 'MEDIUM',   startDate: new Date('2026-03-15'), dueDate: new Date('2026-03-22') },
      { projectId: scc, createdById: pm, assignedToId: eng1, categoryId: cat('Underground Utility'), title: 'Underground Utility', description: 'Survey and mark existing OFC, water, sewer lines before excavation.', status: 'NOT_STARTED', priority: 'CRITICAL', startDate: new Date('2026-04-01'), dueDate: new Date('2026-04-08') },
      { projectId: scc, createdById: pm, assignedToId: eng1, categoryId: cat('Layout Approval'),     title: 'Layout Approval',     description: 'RERA and municipal layout approval pending.',                      status: 'BLOCKED',     priority: 'CRITICAL', startDate: new Date('2026-03-25'), dueDate: new Date('2026-04-10') },
    ],
  });
  console.log('    ✅ Phase 1 — Pre-Construction Work (8 flat tasks)');

  // ── Phase 2: Substructure — parent + subtasks in one nested create (Flow 1: category-based) ──
  await prisma.task.create({
    data: {
      projectId: scc, createdById: pm, assignedToId: eng1,
      categoryId: null,
      title: 'Substructure Work',
      description: 'Foundation and below-plinth work for the commercial complex.',
      status: 'NOT_STARTED', priority: 'CRITICAL',
      startDate: new Date('2026-04-15'), dueDate: new Date('2026-06-30'),
      subtasks: {
        create: [
          { projectId: scc, createdById: pm, assignedToId: eng1, categoryId: cat('Excavation Work'),            title: 'Excavation Work',            description: 'Bulk excavation 3.5m depth for raft foundation.',             status: 'NOT_STARTED', priority: 'CRITICAL', startDate: new Date('2026-04-15'), dueDate: new Date('2026-05-05') },
          { projectId: scc, createdById: pm, assignedToId: eng1, categoryId: cat('Anti-Termite Treatment'),     title: 'Anti-Termite Treatment',     description: 'Chemical treatment on full excavated bed area.',               status: 'NOT_STARTED', priority: 'MEDIUM',   startDate: new Date('2026-05-05'), dueDate: new Date('2026-05-07') },
          { projectId: scc, createdById: pm, assignedToId: eng1, categoryId: cat('PCC (Plain Cement Concrete)'),title: 'PCC (Plain Cement Concrete)', description: 'M15 PCC 150mm thick below raft.',                              status: 'NOT_STARTED', priority: 'HIGH',     startDate: new Date('2026-05-07'), dueDate: new Date('2026-05-15') },
          { projectId: scc, createdById: pm, assignedToId: eng1, categoryId: cat('Foundation Work'),            title: 'Foundation Work',            description: 'M30 raft foundation 600mm thick for 15-floor load.',          status: 'NOT_STARTED', priority: 'CRITICAL', startDate: new Date('2026-05-15'), dueDate: new Date('2026-06-15') },
          { projectId: scc, createdById: pm, assignedToId: eng1, categoryId: cat('Damp Proof Course (DPC)'),   title: 'Damp Proof Course (DPC)',    description: 'Crystalline waterproofing on raft surface before backfilling.',status: 'NOT_STARTED', priority: 'HIGH',     startDate: new Date('2026-06-15'), dueDate: new Date('2026-06-25') },
        ],
      },
    },
  });
  console.log('    ✅ Phase 2 — Substructure Work (1 parent + 5 subtasks, category-based)');

  // ── Custom task with custom subtasks (Flow 2: no category) ──
  await prisma.task.create({
    data: {
      projectId: scc, createdById: pm, assignedToId: eng2,
      categoryId: null,
      title: 'Obtain NOC from Fire Department',
      description: 'Required for commercial building above 15m height.',
      status: 'IN_PROGRESS', priority: 'CRITICAL',
      startDate: new Date('2026-03-20'), dueDate: new Date('2026-04-15'),
      subtasks: {
        create: [
          { projectId: scc, createdById: pm, assignedToId: eng2, categoryId: null, title: 'Submit revised fire exit plans',          status: 'COMPLETED',   priority: 'CRITICAL', dueDate: new Date('2026-03-25'), completedAt: new Date('2026-03-24') },
          { projectId: scc, createdById: pm, assignedToId: eng2, categoryId: null, title: 'Follow up with fire department office',  status: 'IN_PROGRESS', priority: 'HIGH',     dueDate: new Date('2026-04-05') },
          { projectId: scc, createdById: pm, assignedToId: eng1, categoryId: null, title: 'Collect NOC certificate',                status: 'NOT_STARTED', priority: 'HIGH',     dueDate: new Date('2026-04-15') },
        ],
      },
    },
  });
  console.log('    ✅ Custom task + 3 custom subtasks (no category, Flow 2)\n');

  // ── summary ───────────────────────────────────────────────────────
  const [total, withParent] = await Promise.all([
    prisma.task.count(),
    prisma.task.count({ where: { parentId: { not: null } } }),
  ]);
  const parents = await prisma.task.count({ where: { subtasks: { some: {} } } });

  console.log(`🎉 Done! ${total} tasks total`);
  console.log(`   ${parents} parent tasks  |  ${withParent} subtasks  |  ${total - withParent - parents} flat tasks\n`);
  console.log('  Green Valley Residency      → Phase 1 ✅  Phase 2 ✅  Phase 3 🔄  Phase 4 ⏳');
  console.log('  Sunrise Commercial Complex  → Phase 1 🔄  Phase 2 ⏳');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

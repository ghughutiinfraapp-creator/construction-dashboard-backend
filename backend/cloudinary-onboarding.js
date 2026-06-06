const cloudinary = require('cloudinary').v2;

// Step 1 — Configure Cloudinary (inline credentials)
cloudinary.config({
  cloud_name: 'daqradscs',
  api_key:    '178284572217489',
  api_secret: '-EfgQ-nCikb6QH6yScve9E5DSlc',
});

(async () => {
  // Step 2 — Upload a sample image from Cloudinary's demo library
  console.log('Uploading sample image...');
  const uploadResult = await cloudinary.uploader.upload(
    'https://res.cloudinary.com/demo/image/upload/sample.jpg',
    { public_id: 'onboarding_sample' }
  );

  console.log('\n--- Upload Result ---');
  console.log('Secure URL :', uploadResult.secure_url);
  console.log('Public ID  :', uploadResult.public_id);

  // Step 3 — Fetch image metadata
  const details = await cloudinary.api.resource(uploadResult.public_id);

  console.log('\n--- Image Details ---');
  console.log('Width  :', details.width, 'px');
  console.log('Height :', details.height, 'px');
  console.log('Format :', details.format);
  console.log('Size   :', details.bytes, 'bytes');

  // Step 4 — Generate a transformed URL
  // f_auto → Cloudinary picks the best format for the viewer's browser (e.g. WebP, AVIF)
  // q_auto → Cloudinary picks the optimal quality level to reduce file size without visible loss
  const transformedUrl = cloudinary.url(uploadResult.public_id, {
    transformation: [{ fetch_format: 'auto', quality: 'auto' }],
    secure: true,
  });

  console.log('\n--- Transformed Image ---');
  console.log('Done! Click link below to see optimized version of the image. Check the size and the format.');
  console.log(transformedUrl);
})();

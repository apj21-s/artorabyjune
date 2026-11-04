const { z } = require('zod');

// Validates req.body against a zod schema and replaces it with the parsed (clean) value.
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue.path.join('.');
      return res.status(400).json({ error: issue.message || 'Please check the form.', field });
    }
    if (source === 'query') req.validQuery = result.data;
    else req[source] = result.data;
    next();
  };
}

const str = (max = 500) => z.string().trim().max(max);
const email = () => z.string().trim().toLowerCase().email('Please enter a valid email address.').max(200);
const phone = () => z.string().trim().max(20).regex(/^[0-9+\-\s()]*$/, 'Please enter a valid phone number.');
const url = () => z.string().trim().max(1000).refine((v) => !v || /^(https:\/\/|\/uploads\/|\/assets\/)/.test(v), 'Images must be https links or uploaded files.');

module.exports = { validate, z, str, email, phone, url };

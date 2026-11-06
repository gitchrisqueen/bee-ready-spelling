# Security policy

Bee Ready is a public, static spelling-practice site for children. It has no server and collects no accounts. Please report anything that looks wrong, especially a leak of private or personal information.

## How to report a problem or a leak

Use GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability**.
3. Fill in the form. Only the maintainer can read it.

Please do not open a public issue or pull request for a leak or a vulnerability, and do not post the details anywhere public.

## What to include

- Where you saw it: a page URL, a file path, a commit or a workflow run link.
- What you saw and why it matters (for example "a name or address", "a key or token", "a workflow that can write to the repository").
- Steps to see it again, if you know them.
- Whether you shared it with anyone else.

Please do not include the private data itself in your report. Describe where it is instead.

## What to expect

- This is a small project run by one maintainer, not a company with a security team. There is no guaranteed response time.
- You will get a reply in the private report when the maintainer has read it. A real leak is handled first: the file is removed and, where needed, the history is cleaned.
- If the report is a real problem, you will be told when it is fixed. If it is not, you will be told why.

## Emergency takedown (no workflow run needed)

If the live site must come down right now, the repository owner can do it from the GitHub web interface without running any workflow:

- **Settings > Pages > Unpublish site**, or
- **Settings > Environments > github-pages**, then delete the deployment.

Either one takes the published site offline. The source stays in the repository. To bring the site back, first make sure **Settings > Pages > Build and deployment > Source** is set to **GitHub Actions**, then run the "Test and deploy Bee Ready to GitHub Pages" workflow from the Actions tab.

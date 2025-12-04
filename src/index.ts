// TODO: make responses { success: bool, message: string }, fix this mess
import { Elysia, t } from "elysia";
import { html } from "@elysiajs/html";
import { swagger } from "@elysiajs/swagger";
import { staticPlugin } from "@elysiajs/static";

import { Database } from "bun:sqlite";

type Link = {
	id: number;
	original_url: string;
};

const db = new Database("qlink.sqlite", { create: true });
db.run(`
  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    short_code TEXT NOT NULL UNIQUE,
	manage_code TEXT NOT NULL,
    original_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const generateRandomCode = (length = 6): string => {
	const charSet =
		"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	let res = "";

	for (let i = 0; i < length; i++) {
		res += charSet.charAt(Math.floor(Math.random() * charSet.length));
	}

	return res;
};

const extractAuth = (header: string): string => {
	if (!header || !header.startsWith("Basic ")) {
		return "";
	}

	return header.replace("Basic ", "");
};

const app = new Elysia()
	.use(html())
	.use(staticPlugin())
	.use(swagger())

	.group("/api", (api) =>
		api
			.get("/links", () => {
				return db.query(`SELECT * FROM links ORDER BY created_at DESC`).all();
			})
			.post(
				"/links",
				async ({ body, set }) => {
					const { url } = body;

					const shortCode = generateRandomCode();
					const manageCode = generateRandomCode();

					try {
						const query = db.prepare(
							`INSERT INTO links (short_code, manage_code, original_url) VALUES (?, ?, ?) RETURNING *`,
						);
						query.run(shortCode, manageCode, url);

						return {
							short_url: shortCode,
							manage_code: manageCode,
						};
					} catch (error) {
						set.status = 500;
						console.error(error);

						return {
							error: "Failed to create short link",
						};
					}
				},
				{
					body: t.Object({
						url: t.String({ format: "uri" }),
					}),
				},
			)
			.post(
				"/update-link",
				async ({ body, headers, set }) => {
					const manage_code = extractAuth(headers.authorization);
					const { short_code, new_url } = body;

					try {
						const checkQuery = db.prepare(`
							SELECT manage_code
							FROM links
							WHERE short_code  = ?;
						`);
						const existingLink = checkQuery.get(short_code) as
							| {
									manage_code: string;
							  }
							| undefined;

						if (!existingLink) {
							return { message: "Shortcode not found" };
						}

						if (existingLink.manage_code !== manage_code) {
							return { message: "Invalid manage code" };
						}

						const updateQuery = db.prepare(`
							UPDATE links
							SET original_url = ?
							WHERE short_code = ?;	
						`);

						const info = updateQuery.run(new_url, short_code);

						if (info.changes > 0) {
							return { success: true, message: "Update successful" };
						} else {
							return {
								success: true,
								message: "URL was already the provided value.",
							};
						}
					} catch (error) {
						console.error(error);
						set.status = 500;

						return {
							error: "Failed to update shortlink URL",
						};
					}
				},
				{
					body: t.Object({
						short_code: t.String({}),
						new_url: t.String({ format: "uri" }),
					}),
					headers: t.Object({
						authorization: t.String({}),
					}),
				},
			)
			// TODO: add authorization (manage_code) validation
			.delete("/links/:shortCode", ({ params, set }) => {
				const { shortCode } = params;
				const query = db.prepare("DELETE FROM links WHERE short_code = ?");
				const result = query.run(shortCode);

				if (result.changes === 0) {
					set.status = 404;
					return { error: `Link with code ${shortCode} not found.` };
				}

				set.status = 200;
				return { message: `Link with code ${shortCode} deleted successfully.` };
			}),
	)

	.get("/", () => Bun.file("./public/index.html"))
	.get("/links", () => Bun.file("./public/links.html"))
	.get("/l/:shortCode", ({ params, set, redirect }) => {
		const { shortCode } = params;
		const query = db.prepare(
			"SELECT original_url FROM links WHERE short_code = ?",
		);
		const link = query.get(shortCode) as Link | null;

		if (!link) {
			set.status = 404;

			return {
				message: "Link not found",
			};
		}

		return redirect(link.original_url, 302);
	})
	.listen(3000);

console.log(
	`🔗 Qlink on Elysia listening at ${app.server?.hostname}:${app.server?.port}`,
);

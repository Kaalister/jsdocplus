import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const EXISTING_TYPES = [
	'boolean',
	'boolean',
	'number',
	'string',
	'object',
	'array',
	'function',
	'reactnode',
	'void',
	'undefined',
]

interface JSDocInfos {
	type: string,
	name: string,
	description: string,
	extends: string,
	parameters: {
		name: string,
		type: string,
		description: string,
	}[],
	properties: {
		name: string,
		type: string,
		description: string,
	}[],
	returns: {
		type: string,
		description: string,
	}[]
}

interface BorderParam {
	borderStart: string,
	borderEnd: string,
}

export function activate(context: vscode.ExtensionContext) {
	const hoverProvider = vscode.languages.registerHoverProvider([
			'javascript',
			'javascriptreact',
			'typescript',
			'typescriptreact'
		], {
			async provideHover(
				document: vscode.TextDocument,
				position: vscode.Position,
				token: vscode.CancellationToken,
			) {
				const wordRange = document.getWordRangeAtPosition(position);
            	const word = document.getText(wordRange);

				if (isClassName(word)) {
					const classFilePath = await getClassImportPath(document, word);

					if (classFilePath) {
						const classContent = await getClassContent(classFilePath, word);
						console.log(classContent);
						const hoverMessage = new vscode.MarkdownString(classContent);
						return new vscode.Hover(hoverMessage);
					}
				}

				return null;
			}
		}
	);

	context.subscriptions.push(hoverProvider);
}

function isClassName(word: string): boolean {
	return /^[A-Z]/.test(word);
}

async function getClassImportPath(document: vscode.TextDocument, className: string): Promise<string | null> {
    const text = document.getText();
    const importRegex = /import\s+(?:(\w+)|\{([^}]+)\})\s+from\s+['"]([^'"]+)['"]/g;
    let match;

    while ((match = importRegex.exec(text)) !== null) {
        const importedNames = match[1] || match[2]?.split(',').map(name => name.trim());
        const importPath = match[3];

        if ((Array.isArray(importedNames) && importedNames.includes(className)) ||
			importedNames === className
		) {
            const resolvedPath = resolveImportPath(document, importPath);
            if (resolvedPath) {
                return resolvedPath;
            }
        }
    }

    return null;
}

function resolveImportPath(document: vscode.TextDocument, importPath: string): string | null {
    const folderPath = path.dirname(document.fileName);
    const fullPath = path.resolve(folderPath, importPath);

	if (fs.existsSync(fullPath + '.ts')) {
		return fullPath + '.ts';
	}
    else if (fs.existsSync(fullPath + '.js')) {
		return fullPath + '.js';
	}
	else if (fs.existsSync(fullPath + '.jsx')) {
		return fullPath + '.jsx';
	}

    return null;
}

async function getClassContent(filePath: string, className: string): Promise<string> {
    const text = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    const content = text.toString();
	const jsDoc = getJSDoc(content);
	const documentation: JSDocInfos[] = formatJSDoc(jsDoc);

	return docToMarkdown(documentation, className, filePath);
}

function getJSDoc(text: string): string[] {
	const jsDocRegex = /\/\*\*[\s\S]*?\*\//g;
	const matches = text.match(jsDocRegex);
	const cleanedComments = matches?.map(comment => 
        comment
            .replace(/\/\*\*|\*\//g, '')
            .replace(/^\s*\*\s?/gm, '')
            .trim()
    ) || [];
    
    return cleanedComments;
}

function formatJSDoc(jsDoc: string[]): JSDocInfos[] {
	const formattedJSDoc: JSDocInfos[] = [];

	jsDoc.forEach(comment => {
		let lines = comment.split('\n');
		lines = lines.map(line => line.trim());
		let formattedComment: JSDocInfos = {
			type: '',
			name: '',
			extends: '',
			description: '',
			parameters: [],
			properties: [],
			returns: [],
		};

		lines.forEach((line , index) => {
			const elements = line.split(' ');

			switch(elements[0]) {
				case '@typedef':
					formattedComment.type = elements[1];
					formattedComment.name = elements[2];
					break;
				case '@callback':
					formattedComment.type = 'callback';
					formattedComment.name = elements[1];
					break;
				case '@param':
					formattedComment.parameters.push({
						name: elements[2],
						type: elements[1],
						description: line.split('-')[1]?.trim()
					});
					break;
				case '@property':
					formattedComment.properties.push({
						name: elements[2],
						type: elements[1],
						description: line.split('-')[1]?.trim()
					});
					break;
				case '@returns':
				case '@return':
					formattedComment.returns.push({
						type: elements[1],
						description: line.split('-')[1]?.trim()
					});
					break;
				case '@class':
					formattedComment.type = 'class';
					formattedComment.name = elements[1];
					break;
				case '@extends':
					formattedComment.extends = elements[1];
					break;
				case '@function':
					formattedComment.type = 'function';
					break;
				default:
					let lineBefore = lines[index - 1]
					let isDescription = true;

					if (lineBefore) {
						const beforeElements = lineBefore.split(' ');
						let index = 0;
						let desc = '';

						switch(beforeElements[0]) {
							case '@param':
								index = formattedComment.parameters.findIndex(param => (
									param.name === beforeElements[2] &&
									param.type === beforeElements[1]
								))
								if (index !== -1) {
									desc = formattedComment.parameters[index].description;
									formattedComment.parameters[index].description = `${desc} ${line.trim()}`;
									isDescription = false;
								}
								break;
							case '@property':
								index = formattedComment.properties.findIndex(param => (
									param.name === beforeElements[2] &&
									param.type === beforeElements[1]
								))
								if (index !== -1) {
									desc = formattedComment.properties[index].description;
									formattedComment.properties[index].description = `${desc} ${line.trim()}`;
									isDescription = false;
								}
								break;
							case '@returns':
							case '@return':
								index = formattedComment.returns.findIndex(param => (
									param.type === beforeElements[1]
								))
								if (index !== -1) {
									desc = formattedComment.returns[index].description;
									formattedComment.returns[index].description = `${desc} ${line.trim()}`;
									isDescription = false;
								}
								break;
						}
					}

					if (isDescription) {
						formattedComment.description += ` ${line}`;
					}
					break;
			}

		})
		formattedJSDoc.push(formattedComment);
	})

	return formattedJSDoc;
}

function docToMarkdown(
	documentation: JSDocInfos[],
	className: string,
	documentationPath: string,
): string {
	let markdown = ``;

	const noBorder: BorderParam = {
		borderStart: '',
		borderEnd: '',
	}

	const jsBorder: BorderParam = {
		borderStart: '\`',
		borderEnd: '\`',
	}

	documentation.sort((a, b) => {
		if (a.type === 'class' && b.type !== 'class') {
			return -1;
		}
		else if (a.type !== 'class' && b.type === 'class') {
			return 1;
		}
		else {
			return 0;
		}
	}).forEach(item => {
		markdown += `## ${item.name} \n\n`

		switch(item.type) {
			case 'callback':
				markdown += '```js\n';
				markdown += `${renderType('function', noBorder)} ${item.name}\n\n`;
				markdown += '```\n';
				break;
			case 'function':
				markdown += '```js\n';
				markdown += `${renderType('function', noBorder)} ${className}.${item.name}\n\n`;
				markdown += '```\n';
				break;
			case 'class':
				markdown += '```js\n';
				markdown += `${renderType('class', noBorder)} ${className} ${item?.extends ? `extends ${renderType(item.extends, noBorder)}` : ''}\n\n`;
				markdown += '```\n';
				break;
			default:
				markdown += '```js\n';
				markdown += `${renderType(item.type, noBorder)} ${item.name}\n\n`;
				markdown += '```\n';
				break;
		}
		
		if (item.description !== '') {
			markdown += `### Description\n${item.description}\n\n`;
		}

		if (item.properties.length > 0) {
			markdown += `### Properties\n\n`;
			item.properties.forEach(property => {
				let type = `${renderType(property.type, jsBorder)}`

				if (!isExistingType(property.type)) {
					type = `[${type}](${renderRef(property.type, documentationPath)})`;
				}

				markdown += `- ${renderName(property.name)} : ${type} - ${property.description}\n\n`;
			});
			markdown += `\n`;
		}
		if (item.parameters.length > 0) {
			markdown += `### Parameters\n\n`;
			item.parameters.forEach(parameter => {
				let type = `${renderType(parameter.type, jsBorder)}`

				if (!isExistingType(parameter.type)) {
					type = `[${type}](${renderRef(parameter.type, documentationPath)})`;
				}

				markdown += `- ${renderName(parameter.name)} : ${type} - ${parameter.description}\n\n`;
			});
			markdown += `\n`;
		}
		if (item.returns.length > 0) {
			markdown += `### Returns\n\n`;
			item.returns.forEach(returnType => {
				let type = `${renderType(returnType.type, jsBorder)}`

				if (!isExistingType(returnType.type)) {
					type = `[${type}](${renderRef(returnType.type, documentationPath)})`;
				}

				markdown += `- ${renderType(returnType.type, jsBorder)} : ${returnType.description}\n\n`;
			});
			markdown += `\n`;
		}

		markdown += `---\n\n`;
	});

	return markdown;
}

function renderType(
	type: string,
	params: BorderParam = {
		borderStart: '```',
		borderEnd: '```',
	}
): string {
	let value = type;
	if (value.startsWith('{') && value.endsWith('}')) {
		value = value.replace('{', '').replace('}', '');
	}

	return `${params.borderStart}${value}${params.borderEnd}`;
}

function renderName(
	name: string,
	params: BorderParam = {
		borderStart: '**',
		borderEnd: '**',
	}
): string {
	let value = name;
	let isRequired = true;
	let defaultValue = null;

	if (value.startsWith('[') && value.endsWith(']')) {
		value = value.replace('[', '').replace(']', '');
		isRequired = false;
	}

	if (value.includes('=')) {
		const [currentName, initValue] = value.split('=');
		value = currentName;
		defaultValue = initValue;
	}

	return `${params.borderStart}${value}${!isRequired ? '?' : ''}${params.borderEnd} ${defaultValue ? ` (default: ${defaultValue})` : ''}`;
}

function renderRef(ref: string, documentationPath: string): string {
	console.log('ref', ref);

	if (ref.startsWith('{') && ref.endsWith('}')) {
		ref = ref.replace('{', '').replace('}', '');
	}

	ref = ref.trim().toLowerCase();

	console.log('ref after :', ref);
	return `${documentationPath}#${ref}`
}

function isExistingType(type: string): boolean {
	if (type.startsWith('{') && type.endsWith('}')) {
		type = type.replace('{', '').replace('}', '');
	}
	if (type.endsWith(']')) {
		type = type.replace('[', '').replace(']', '');
	}

	return EXISTING_TYPES.includes(type.toLowerCase());
}

export function deactivate() {}

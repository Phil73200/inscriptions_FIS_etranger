import { program } from 'commander';
import * as puppeteer from 'puppeteer';
import Enquirer from 'enquirer';
import dayjs from 'dayjs';
import minMax from 'dayjs/plugin/minMax';
dayjs.extend(minMax);
// Structure de données qui définit les informations qu'on va récupérer pour chaque course
interface RaceInfo {
    title: string;            // Le titre contenant le lieu et le pays
    organizerEmail: string;   // L'email de l'organisateur
    date: string;            // La date de la course
    dates: string[];         // Tableau des dates uniques
    url: string;             // URL de la page de la course
}

// Fonction pour demander le codex à l'utilisateur
async function promptForCodex(): Promise<string> {
    const enquirer = new Enquirer();
    const response = await enquirer.prompt({
        type: 'input',
        name: 'codex',
        message: 'Veuillez entrer le codex FIS de la course :',
        validate: (value) => {
            if (!value) return 'Le codex est requis';
            return true;
        }
    }) as { codex: string };
    return response.codex;
}

// Fonction qui extrait les dates uniques de la page
async function extractUniqueDates(page: puppeteer.Page): Promise<string[]> {
    const dates = await page.evaluate(() => {
        const dateElements = document.querySelectorAll('.timezone-date');
        const datesSet = new Set<string>();

        dateElements.forEach(element => {
            const date = element.getAttribute('data-date');
            if (date) {
                datesSet.add(date);
            }
        });

        return Array.from(datesSet);
    });

    return dates;
}

// Fonction principale qui va chercher les informations sur le site de la FIS
async function scrapeRaceInfo(codex: string): Promise<RaceInfo> {
    // Démarre un navigateur invisible qui va automatiquement naviguer sur le site
    const browser = await puppeteer.launch({ headless: true });

    try {
        // Crée une nouvelle page web dans le navigateur
        const page = await browser.newPage();

        // Configure la taille de la fenêtre pour afficher en format desktop
        await page.setViewport({
            width: 1532,
            height: 1080,
            deviceScaleFactor: 1,
        });

        // Va sur la page du calendrier FIS
        await page.goto('https://www.fis-ski.com/DB/alpine-skiing/calendar-results.html?noselection=true&mi=menu-calendar');
        // accepte les cookies en cliquant sur le bouton Allow all
        await page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const allowButton = buttons.find(button => button.textContent?.includes('Allow all'));
            if (allowButton) {
                (allowButton as HTMLButtonElement).click();
            }
        });
        // Attend un peu que la popup des cookies disparaisse
        await new Promise(resolve => setTimeout(resolve, 1000));
        // Entre le codex dans la barre de recherche et appuie sur Entrée
        await page.type('#racecodex', codex);
        await page.keyboard.press('Enter');
        // Attend 2 secondes que les résultats s'affichent
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Compte le nombre de résultats trouvés
        const results = await page.$$('.container .g-row');
        // Si aucun résultat n'est trouvé, affiche une erreur
        if (results.length === 0) {
            throw new Error('Aucun résultat trouvé pour ce codex');
        }
        // Si plusieurs résultats sont trouvés, affiche une erreur car on veut un résultat unique
        if (results.length > 1) {
            throw new Error('Plusieurs résultats trouvés pour ce codex. Veuillez fournir un codex plus précis.');
        }

        // Clique sur le lien de la course pour accéder aux détails
        await page.click('.g-row > a:first-child');
        // Attend 2 secondes que la page se charge
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Affiche l'URL de la page de la course
        const url = page.url();
        console.log('URL de la page de la course:', url);

        // Recupere la categorie (level)

        // Récupère le titre de la page qui contient le lieu et le pays
        const title = await page.$eval('.event-header__name', el => el.textContent?.trim() || '');



        // Cherche l'email de l'organisateur dans les détails de la course
        const organizerEmail = await page.evaluate(() => {
            // Cherche d'abord Entries Email
            const rows = Array.from(document.querySelectorAll('.tbody .table-row'));
            for (const row of rows) {
                const cells = Array.from(row.querySelectorAll('.g-row.container > div'));
                if (cells.length >= 2) {
                    const label = cells[0].textContent?.trim().toLowerCase() || '';
                    const value = cells[1].querySelector('a')?.textContent?.trim() || '';

                    if (label === 'entries email :' && value) {
                        return value.replace('[at]', '@');
                    }
                }
            }

            // Si pas trouvé, cherche General Email
            for (const row of rows) {
                const cells = Array.from(row.querySelectorAll('.g-row.container > div'));
                if (cells.length >= 2) {
                    const label = cells[0].textContent?.trim().toLowerCase() || '';
                    const value = cells[1].querySelector('a')?.textContent?.trim() || '';

                    if (label === 'general email :' && value) {
                        return value.replace('[at]', '@');
                    }
                }
            }

            // Si aucun email trouvé, lance une erreur
            throw new Error('Aucun email trouvé pour ce codex');
        });

        // Récupère les dates uniques
        const dates = await extractUniqueDates(page);

        const date = new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });

        // Renvoie toutes les informations récupérées
        const raceInfo = {
            title,
            organizerEmail,
            date,
            dates,
            url
        };

        // Remplacer generateCSV par displayRaceInfo
        displayRaceInfo(raceInfo, codex);

        return raceInfo;
    } finally {
        // Ferme le navigateur pour libérer les ressources
        await browser.close();
    }
}

// Fonction utilitaire pour rendre le texte cliquable et copiable
function makeTextClickableAndCopyable(text: string): string {
    return `\x1b]8;;copy:${text}\x1b\\${text}\x1b]8;;\x1b\\`;
}

// Remplacer la fonction generateCSV par une fonction d'affichage
function displayRaceInfo(raceInfo: RaceInfo, codex: string) {
    const minDate = dayjs.min(raceInfo.dates.map(date => dayjs(date)));
    const maxDate = dayjs.max(raceInfo.dates.map(date => dayjs(date)));

    console.log('\n=== Informations de la course ===');
    console.log(`Codex: ${codex}`);
    console.log(`Lieu: ${raceInfo.title}`);
    console.log(`Email: ${raceInfo.organizerEmail}`);
    console.log('\nDates:');
    raceInfo.dates.forEach(date => console.log(`  - ${date}`));
    console.log('Periodes:')

    // Format the period based on whether it's a single day or multiple days
    let periodText = '';
    if (minDate?.isSame(maxDate, 'day')) {
        periodText = `${minDate?.format('DD MMM YY')} \x1b[34m${raceInfo.title}\x1b[0m`;
    } else if (minDate?.isSame(maxDate, 'month')) {
        periodText = `${minDate?.format('DD')}-${maxDate?.format('DD MMM YY')} ➙ \x1b[34m${raceInfo.title}\x1b[0m`;
    } else {
        periodText = `${minDate?.format('DD MMM')} - ${maxDate?.format('DD MMM YYYY')} ➞ \x1b[34m${raceInfo.title}\x1b[0m`;
    }

    // Rend le texte cliquable et copiable
    console.log(makeTextClickableAndCopyable(periodText.replace(/\x1b\[[0-9;]*m/g, '')));

    console.log(`\nURL: ${raceInfo.url}`);
    console.log('===============================\n');
}

// Configuration de l'interface en ligne de commande
program
    .name('fis-scraper')
    .description('Outil pour récupérer les informations des courses FIS')
    .option('-c, --codex <codex>', 'Codex FIS de la course');

program.parse();

// Récupère les options fournies par l'utilisateur
const options = program.opts();

// Fonction principale qui s'exécute immédiatement
(async () => {
    try {
        let codex = options.codex;

        // Si aucun codex n'est fourni, demande à l'utilisateur
        if (!codex) {
            codex = await promptForCodex();
        }

        console.log('Récupération des informations de la course...');
        const raceInfo = await scrapeRaceInfo(codex);
    } catch (error: unknown) {
        if (error instanceof Error) {
            console.error('Erreur:', error.message);
        } else {
            console.error('Une erreur inconnue est survenue');
        }
        process.exit(1);
    }
})();
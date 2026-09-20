// ⚠️ TRES IMPORTANT : REMPLACEZ L'IP CI-DESSOUS PAR CELLE DE VOTRE SERVEUR KATABUMP
// Si Katabump vous donne une adresse web pour le port 3000, mettez-la ici.
const API_URL = "http://51.75.118.17:3000/api"; 

async function chargerDonnees(collection) {
    document.getElementById('titre-section').innerText = `Gestion des ${collection}`;
    const contenuDiv = document.getElementById('contenu');
    contenuDiv.innerHTML = "<p class='text-gray-400'>Chargement des données en cours...</p>";

    try {
        // Le site demande les données au bot
        const response = await fetch(`${API_URL}/${collection}`);
        const data = await response.json();
        afficherFormulaires(collection, data);
    } catch (error) {
        contenuDiv.innerHTML = `<p class="text-red-500 font-bold">Erreur de connexion. Vérifiez que l'API du bot tourne bien sur le port 3000 de Katabump et que l'IP est correcte dans app.js.</p>`;
        console.error("Erreur Fetch:", error);
    }
}

function afficherFormulaires(collection, dataList) {
    const contenuDiv = document.getElementById('contenu');
    contenuDiv.innerHTML = ''; 

    // Si aucune donnée n'est trouvée
    if (dataList.length === 0) {
        contenuDiv.innerHTML = "<p class='text-gray-400'>Aucune donnée trouvée pour cette catégorie.</p>";
        return;
    }

    // On crée une carte d'édition pour chaque élément (chaque maison, profil, etc.)
    dataList.forEach(item => {
        const carte = document.createElement('div');
        carte.className = "bg-gray-800 p-6 rounded-lg shadow-md border border-gray-700";

        let champsHTML = '';
        for (const [key, value] of Object.entries(item)) {
            const isId = (key === '_id');
            const bgClass = isId ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-gray-900 text-white border border-gray-600 focus:border-red-500 focus:outline-none';
            const readonly = isId ? 'readonly' : '';
            
            // On convertit les objets complexes (comme un inventaire) en texte JSON pour pouvoir les éditer
            const displayValue = typeof value === 'object' ? JSON.stringify(value) : value;

            champsHTML += `
                <div class="mb-4">
                    <label class="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">${key}</label>
                    <input type="text" id="${collection}-${item._id}-${key}" value='${displayValue}' class="${bgClass} p-2 rounded w-full" ${readonly}>
                </div>
            `;
        }

        champsHTML += `<button onclick="sauvegarder('${collection}', '${item._id}')" class="w-full bg-red-700 hover:bg-red-600 text-white p-3 rounded font-bold mt-4 transition">Enregistrer les modifications</button>`;
        
        carte.innerHTML = champsHTML;
        contenuDiv.appendChild(carte);
    });
}

async function sauvegarder(collection, id) {
    const inputs = document.querySelectorAll(`[id^="${collection}-${id}-"]`);
    const nouvellesDonnees = {};

    inputs.forEach(input => {
        const key = input.id.replace(`${collection}-${id}-`, '');
        if (key !== '_id') {
            // Si la donnée était un objet JSON (ex: inventaire), on essaie de la reconvertir, sinon on la garde en texte
            try {
                nouvellesDonnees[key] = JSON.parse(input.value);
            } catch (e) {
                nouvellesDonnees[key] = input.value;
            }
        }
    });

    try {
        // Le site envoie les nouvelles données au bot
        const response = await fetch(`${API_URL}/${collection}/${id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(nouvellesDonnees)
        });
        
        const result = await response.json();
        if (result.success) {
            alert("Mise à jour réussie ! Les données ont été envoyées au bot.");
        }
    } catch (error) {
        alert("Erreur lors de la sauvegarde. Vérifiez la console (F12).");
        console.error("Erreur Post:", error);
    }
}
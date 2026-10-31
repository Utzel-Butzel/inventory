package de.internetderdinge.inventory.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import de.internetderdinge.inventory.data.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

val JsonSaver = Saver<JSONObject, String>(save = { it.toString() }, restore = { JSONObject(it) })
val UploadsSaver = Saver<List<Upload>, String>(save = { uploads -> JSONArray(uploads.map { obj("path" to it.file.path, "name" to it.name, "mime" to it.mime) }).toString() }, restore = { json -> JSONArray(json).objects().map { Upload(File(it.getString("path")), it.getString("name"), it.getString("mime")) } })
@Composable fun rememberJson(vararg inputs: Any?, initial: () -> JSONObject): MutableState<JSONObject> = rememberSaveable(*inputs, stateSaver = JsonSaver) { mutableStateOf(initial()) }

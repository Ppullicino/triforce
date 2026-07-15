package com.triforce.remote

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class CredentialVault(context: Context) {
    private val preferences = context.getSharedPreferences("encrypted_credentials", Context.MODE_PRIVATE)
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    fun set(hostId: String, token: String) {
        require(token.isNotEmpty()) { "credential cannot be empty" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val value = Base64.encodeToString(cipher.iv + cipher.doFinal(token.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        preferences.edit().putString(storageKey(hostId), value).apply()
    }

    fun get(hostId: String): String? {
        val encoded = preferences.getString(storageKey(hostId), null) ?: return null
        val value = Base64.decode(encoded, Base64.NO_WRAP)
        require(value.size > IV_BYTES) { "invalid encrypted credential" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, value.copyOfRange(0, IV_BYTES)))
        return cipher.doFinal(value.copyOfRange(IV_BYTES, value.size)).toString(Charsets.UTF_8)
    }

    fun delete(hostId: String) { preferences.edit().remove(storageKey(hostId)).apply() }

    private fun key(): SecretKey {
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build())
        return generator.generateKey()
    }

    private fun storageKey(hostId: String) = "host_${hostId.replace(Regex("[^A-Za-z0-9_-]"), "_")}"

    companion object {
        private const val KEY_ALIAS = "triforce_credentials_v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_BYTES = 12
    }
}
